/**
 * What the providers do with settings and credentials: normalized addresses, precedence, scoped
 * authentication, tenant isolation of cached records, and the absence of secrets in everything returned.
 */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Resolution } from '@beyond-js/packages/resolution';
import { ProvidersSettings, Endpoint } from '@beyond-js/packages/providers/settings';
import { MemoryMetadataStore } from '@beyond-js/packages/providers';
import { FakeRegistry } from './registry.mjs';
import { step, codes, valid } from './harness.mjs';

const TOKEN = 'npm_SECRETtokenA1B2C3';
const OTHER = 'npm_OTHERtokenZ9Y8X7';

export async function providers({ registry, documents }) {
	const restricted = await new FakeRegistry({ prefix: '/private/npm', token: TOKEN }).start();
	await restricted.publish({ name: '@acme/ui', version: '2.0.0', dependencies: { 'diamond-base': '^2.0.0' } });
	const root = await mkdtemp(join(tmpdir(), 'beyond-cdn-resolution-'));

	const values = token => ({
		default: { registry: registry.url },
		scopes: { '@acme': { registry: `${restricted.url}/`, auth: token && { mode: 'token', token } } }
	});
	const outputs = [];
	const pin = async params => {
		const lines = [];
		const log = (text, meta) => lines.push(`${text} ${meta ? JSON.stringify(meta) : ''}`);
		const document = await Resolution.pin({ logger: { info: log, warn: log, error: log }, ...params });
		outputs.push(JSON.stringify(document), ...lines);
		documents.push(document);
		return document;
	};

	try {
		await step('addresses: scheme, host, port and prefix are normalized once', async () => {
			const endpoint = new Endpoint('HTTP://User:Pass@Registry.Example:8080/npm/path/?x=1#y');
			assert.equal(endpoint.base, 'http://registry.example:8080/npm/path');
			assert.equal(endpoint.registry, 'registry.example:8080/npm/path');
			assert.equal(endpoint.url('@acme%2Fui', '1.0.0'), 'http://registry.example:8080/npm/path/@acme%2Fui/1.0.0');
			assert.deepEqual(endpoint.keys, [
				'registry.example:8080/npm/path',
				'registry.example:8080/npm',
				'registry.example:8080'
			]);
			assert.equal(new Endpoint('https://registry.example:443/').base, 'https://registry.example');
			assert.equal(new Endpoint('//registry.example/npm/').registry, 'registry.example/npm');
			assert.equal(new Endpoint('not a url').valid, false);
		});

		await step('precedence: options > environment > project > workspace > user > global rc', async () => {
			const project = join(root, 'workspace', 'project');
			await mkdir(project, { recursive: true });
			const files = {
				project: join(project, '.npmrc'),
				workspace: join(root, 'workspace', '.npmrc'),
				user: join(root, 'user.npmrc'),
				global: join(root, 'global.npmrc')
			};
			for (const [level, file] of Object.entries(files)) {
				await writeFile(
					file,
					`@acme:registry=https://${level}.example/npm/\nregistry=https://${level}.example/\n`
				);
			}

			const options = {
				path: project,
				workspace: join(root, 'workspace'),
				user: files.user,
				global: files.global,
				env: { 'NPM_SCOPE_@acme': 'https://env.example/npm', NPM_REGISTRY: 'https://env.example/' },
				values: {
					default: { registry: 'https://options.example' },
					scopes: { '@acme': { registry: 'https://options.example/npm' } }
				}
			};
			const observed = [];
			const load = async () => {
				const settings = new ProvidersSettings(options);
				await settings.load();
				const scoped = settings.get({ package: '@acme/ui' });
				const unscoped = settings.get({ package: 'react' });
				assert.equal(new URL(scoped.base).hostname, new URL(unscoped.base).hostname);
				observed.push(`${scoped.origin}:${scoped.base}`);
			};

			await load();
			delete options.values;
			await load();
			options.env = false;
			await load();
			for (const level of ['project', 'workspace', 'user', 'global']) {
				await rm(files[level]);
				await load();
			}
			assert.deepEqual(observed, [
				'options:https://options.example/npm',
				'env-vars:https://env.example/npm',
				'project-rc:https://project.example/npm',
				'workspace-rc:https://workspace.example/npm',
				'user-rc:https://user.example/npm',
				'global-rc:https://global.example/npm',
				'default:https://registry.npmjs.org'
			]);
		});

		await step('environment: a registry with or without scheme never gets a second scheme', async () => {
			const load = async env => {
				const settings = new ProvidersSettings({ user: false, global: false, env });
				await settings.load();
				return settings.default;
			};
			assert.equal((await load({ NPM_REGISTRY: 'https://env.example/npm/' })).base, 'https://env.example/npm');
			assert.equal((await load({ NPM_REGISTRY: 'env.example:8443' })).base, 'https://env.example:8443');
			assert.equal((await load({ NPM_REGISTRY: 'http://env.example' })).base, 'http://env.example');

			const authenticated = await load({ NPM_REGISTRY: 'env.example', NPM_TOKEN: TOKEN });
			assert.deepEqual(authenticated.auth, { mode: 'token', token: TOKEN });
		});

		await step('isolation: settings instances share no state, and the global file is awaited', async () => {
			const first = new ProvidersSettings({
				user: false,
				global: false,
				env: { NPM_REGISTRY: 'first.example', NPM_TOKEN: TOKEN }
			});
			await first.load();
			const second = new ProvidersSettings({ user: false, global: false, env: false });
			await second.load();
			assert.equal(second.default.base, 'https://registry.npmjs.org');
			assert.deepEqual(second.default.auth, { mode: 'none' });
			assert.equal(first.default.base, 'https://first.example');

			// The location of the global file is asked to the package manager: the load waits for it
			const discovered = new ProvidersSettings({ path: root, user: false, env: false });
			await discovered.load();
			assert.equal(discovered.loaded, true);
		});

		await step('credentials: a host credential applies to its port and prefix only', async () => {
			const project = join(root, 'credentials');
			await mkdir(project, { recursive: true });
			const host = new URL(restricted.url).host;
			await writeFile(
				join(project, '.npmrc'),
				[
					`@acme:registry=${restricted.url}/`,
					`//${host}/private/npm/:_authToken=\${ACME_TOKEN}`,
					`@other:registry=http://${host}/public/npm/`,
					`@elsewhere:registry=http://127.0.0.1:1/private/npm/`
				].join('\n')
			);

			const settings = new ProvidersSettings({
				path: project,
				user: false,
				global: false,
				env: { ACME_TOKEN: TOKEN }
			});
			await settings.load();
			assert.deepEqual(settings.get({ package: '@acme/ui' }).auth, { mode: 'token', token: TOKEN });
			assert.equal(settings.get({ package: '@acme/ui' }).registry, `${host}/private/npm`);
			assert.deepEqual(settings.get({ package: '@other/ui' }).auth, { mode: 'none' });
			assert.deepEqual(settings.get({ package: '@elsewhere/ui' }).auth, { mode: 'none' });
			assert.deepEqual(settings.get({ package: 'react' }).auth, { mode: 'none' });
		});

		await step('private registry: scoped authentication on a custom port and prefix', async () => {
			registry.reset();
			restricted.reset();
			const document = await pin({
				roots: { '@acme/ui': '^2.0.0' },
				providers: { values: values(TOKEN) },
				tenant: 'acme'
			});
			assert.ok(valid(document), JSON.stringify(document.diagnostics));

			const [ui] = Object.values(document.nodes).filter(({ name }) => name === '@acme/ui');
			const [base] = Object.values(document.nodes).filter(({ name }) => name === 'diamond-base');
			// The registry answers nothing without the token: the anonymous probe keeps the release private
			assert.deepEqual([ui.visibility, ui.access], ['private', 'credential']);
			assert.equal(ui.origin.registry, `${restricted.url}/`);
			assert.match(ui.origin.provider, /^registry-127-0-0-1-\d+-private-npm-[0-9a-f]{32}$/);
			assert.ok(ui.tarball.startsWith(`${restricted.url}/@acme/ui/-/`));
			assert.match(ui.integrity, /^sha512-/);
			assert.equal(base.visibility, 'public');
			assert.equal(base.origin.registry, `${registry.url}/`);
			assert.notEqual(base.origin.provider, ui.origin.provider);

			// Every request with the credential was authorized; the anonymous probe was refused and carried none
			const credentialed = restricted.log.filter(({ credential }) => credential);
			assert.ok(credentialed.length && credentialed.every(({ authorized }) => authorized));
			assert.ok(restricted.log.filter(({ credential }) => !credential).every(({ authorized, type }) => !authorized && type === 'packument'));
			assert.ok(
				registry.log.length && registry.log.every(({ credential }) => !credential),
				'a credential reached the public registry'
			);
		});

		await step('private registry: a refused credential is a diagnostic, not an exception', async () => {
			const document = await pin({
				roots: { '@acme/ui': '^2.0.0' },
				providers: { values: values(OTHER) },
				tenant: 'intruder'
			});
			assert.equal(valid(document), false);
			assert.deepEqual(codes(document, 'error'), ['PROVIDER_AUTH_REQUIRED']);
			assert.deepEqual(Object.keys(document.nodes), []);
		});

		await step('tenants: private records of one tenant are never served to another', async () => {
			const store = new MemoryMetadataStore();
			const roots = { '@acme/ui': '^2.0.0' };

			const owner = await pin({ roots, providers: { values: values(TOKEN) }, tenant: 'acme', store });
			assert.ok(valid(owner));
			assert.ok(store.keys.some(key => key.startsWith('org:acme|packument|') && key.endsWith('|@acme/ui')));

			// Same shared store, no credential: the record of the owner is not reachable
			restricted.reset();
			const stranger = await pin({ roots, providers: { values: values() }, tenant: 'globex', store });
			assert.equal(valid(stranger), false);
			assert.deepEqual(codes(stranger, 'error'), ['PROVIDER_AUTH_REQUIRED']);
			assert.equal(restricted.requests.packument, 1, 'the stranger was answered from the cache');

			// A second authorized tenant gets a record of its own
			const partner = await pin({ roots, providers: { values: values(TOKEN) }, tenant: 'initech', store });
			assert.ok(valid(partner));
			const records = store.keys
				.filter(key => key.endsWith('|@acme/ui'))
				.map(key => key.split('|')[0])
				.sort();
			assert.deepEqual(records, ['org:acme', 'org:initech']);
			assert.ok(store.keys.some(key => key.startsWith('public|packument|') && key.endsWith('|diamond-base')));
			outputs.push(JSON.stringify(store.keys));
		});

		await step('secrets: no credential appears in documents, diagnostics, logs or cache keys', async () => {
			const embedded = restricted.url.replace('http://', 'http://robot:hunter2SECRET@');
			const leaky = {
				default: { registry: registry.url },
				scopes: { '@acme': { registry: embedded, auth: { mode: 'token', token: OTHER } } }
			};
			const document = await pin({ roots: { '@acme/ui': '^2.0.0' }, providers: { values: leaky } });
			assert.equal(valid(document), false);

			const text = outputs.join('\n');
			assert.ok(text.length > 1000);
			for (const secret of [TOKEN, OTHER, 'hunter2SECRET', 'Bearer', 'Authorization']) {
				assert.ok(!text.includes(secret), `"${secret}" appears in an output`);
			}
		});
	} finally {
		await restricted.stop();
		await rm(root, { recursive: true, force: true });
	}
}
