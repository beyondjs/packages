import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Served } from './support/served.mjs';

/**
 * Type browsing (`beyond-types/1`, `GET /types?specifier=&importer=`) of the real development service started from
 * this checkout, over a copy of `fixtures/` (read its README): generated declarations of workspace modules, the
 * declarations installed packages publish and their `@types` packages, how a reference is followed from the package
 * that imports it, and each refusal by its code.
 */
const served = new Served();
before(() => served.start(), { timeout: 600000 });
after(() => served.stop(), { timeout: 120000 });

const APP = '@types-fixture/app@1.0.0';
const types = (specifier, importer) => {
	const query = new URLSearchParams({ specifier, ...(importer !== void 0 ? { importer } : {}) });
	return served.send('GET', `/types?${query}`, { headers: served.headers });
};
const refused = answer => [answer.status, answer.body?.error?.code];
const digest = text => `sha256-${createHash('sha256').update(text).digest('hex')}`;

test('the service claims type browsing and keeps the declaration route', async () => {
	assert.equal(served.session.capabilities.types, 1);
	assert.equal(served.session.capabilities.declarations, 1);
	const declaration = await served.send('GET', '/declarations/@types-fixture/app/text', { headers: served.headers });
	assert.equal(declaration.status, 200);
	assert.match(declaration.body, /declare module "@types-fixture\/app\/text"/);
});

test('a workspace module answers the declaration its bundler generates, with the references it keeps', async () => {
	const { status, headers, body } = await types('@types-fixture/app/main');
	assert.equal(status, 200, JSON.stringify(body));
	assert.equal(headers['cache-control'], 'no-store');
	assert.match(headers['beyond-cursor'], /^[0-9a-z]+:\d+$/);
	assert.equal(body.protocol, 'beyond-types/1');
	assert.equal(body.provenance, 'generated');
	assert.deepEqual(body.package, { name: '@types-fixture/app', version: '1.0.0', provider: 'workspace' });
	assert.equal(body.vspecifier, `${APP}/main`);
	assert.equal(body.form, 'declaration');
	assert.equal(body.file, void 0);
	assert.match(body.text, /declare module "@types-fixture\/app\/main" \{/);
	assert.match(body.text, /render/);
	assert.deepEqual(body.references, [
		{ specifier: 'typed-lib', importer: `${APP}/main` },
		{ specifier: 'conditioned', importer: `${APP}/main` },
		{ specifier: '@types-fixture/app/text', importer: `${APP}/main` }
	], body.text);

	// The same declaration as the declaration route, identified by the hash the build names
	const declaration = await served.send('GET', '/declarations/@types-fixture/app/main', { headers: served.headers });
	assert.equal(body.text, declaration.body);
	assert.equal(`"${body.etag}"`, declaration.headers.etag);
});

test('an installed package answers what it declares, from the importer, as a type check reads it', async () => {
	const typed = await types('typed-lib', `${APP}/main`);
	assert.equal(typed.status, 200, JSON.stringify(typed.body));
	assert.deepEqual([typed.body.provenance, typed.body.file, typed.body.form], ['package', 'index.d.ts', 'declaration']);
	assert.deepEqual(typed.body.package, { name: 'typed-lib', version: '1.0.0', provider: 'installation' });
	assert.equal(typed.body.importer, `${APP}/main`);
	assert.equal(typed.body.etag, digest(readFileSync(join(served.root, 'node_modules/typed-lib/index.d.ts'))));
	assert.match(typed.body.text, /typed-lib 1\.0\.0/);

	// The exports of conditioned: its "import" target has no declaration beside it, so its "types" condition answers
	const conditioned = await types('conditioned', `${APP}/main`);
	assert.equal(conditioned.status, 200, JSON.stringify(conditioned.body));
	assert.deepEqual([conditioned.body.provenance, conditioned.body.file], ['package', 'dist/index.d.ts']);
	assert.deepEqual(conditioned.body.references, [{ specifier: 'typed-lib', importer: `${APP} > conditioned` }]);

	// Followed from conditioned, typed-lib is the release installed for it, not the workspace's
	const nested = await types('typed-lib', conditioned.body.references[0].importer);
	assert.equal(nested.status, 200, JSON.stringify(nested.body));
	assert.deepEqual(nested.body.package, { name: 'typed-lib', version: '2.0.0', provider: 'installation' });
	assert.match(nested.body.text, /typed-lib 2\.0\.0/);

	// Without an importer, the root of the workspace is the context
	assert.equal((await types('typed-lib')).body.package.version, '1.0.0');
});

test('the exports of a package decide its subpaths: a default after an import, a pattern, an exclusion, a subpath it does not export', async () => {
	const extra = await types('conditioned/extra', `${APP}/main`);
	assert.deepEqual([extra.status, extra.body.file], [200, 'dist/extra.d.ts'], JSON.stringify(extra.body));
	const alpha = await types('conditioned/features/alpha');
	assert.deepEqual([alpha.status, alpha.body.file], [200, 'dist/features/alpha.d.ts'], JSON.stringify(alpha.body));

	const hidden = await types('conditioned/hidden');
	assert.deepEqual(refused(hidden), [404, 'DECLARATION_NOT_FOUND']);
	assert.match(hidden.body.error.message, /exclude "\.\/hidden"/);
	const missing = await types('conditioned/missing');
	assert.deepEqual(refused(missing), [404, 'DECLARATION_NOT_FOUND']);
	assert.match(missing.body.error.message, /do not export "\.\/missing"/);
});

test('without exports: types without an extension, a subpath file and a subpath directory', async () => {
	for (const [specifier, file] of [['subpaths', 'lib/index.d.ts'], ['subpaths/single', 'single.d.ts'], ['subpaths/lib/parts', 'lib/parts/index.d.ts']]) {
		const answer = await types(specifier);
		assert.deepEqual([answer.status, answer.body.file, answer.body.provenance], [200, file, 'package'], `${specifier}: ${JSON.stringify(answer.body)}`);
	}
});

test('a package without declarations is typed by its reachable @types package, or has none', async () => {
	const untyped = await types('untyped', `${APP}/main`);
	assert.equal(untyped.status, 200, JSON.stringify(untyped.body));
	assert.deepEqual([untyped.body.provenance, untyped.body.file], ['types-package', 'index.d.ts']);
	assert.deepEqual(untyped.body.package, { name: '@types/untyped', version: '1.0.0', provider: 'installation' });
	assert.deepEqual(untyped.body.references, [{ specifier: 'typed-lib', importer: `${APP} > @types/untyped` }], 'a reference directive is a reference');

	const plain = await types('javascript-only');
	assert.deepEqual(refused(plain), [404, 'DECLARATION_NOT_FOUND']);
	assert.match(plain.body.error.message, /"javascript-only" 1\.0\.0: it declares no types/);
	const absent = await types('not-installed', `${APP}/main`);
	assert.deepEqual(refused(absent), [404, 'DECLARATION_NOT_FOUND']);
	assert.match(absent.body.error.message, /not installed for @types-fixture\/app@1\.0\.0/);
});

test('a package that publishes TypeScript sources answers the source a type check reads', async () => {
	const answer = await types('source-lib/main');
	assert.equal(answer.status, 200, JSON.stringify(answer.body));
	assert.deepEqual([answer.body.provenance, answer.body.form, answer.body.file], ['package', 'source', 'main/index.ts']);
	assert.deepEqual(answer.body.references, [{ specifier: 'typed-lib', importer: '. > source-lib' }]);
});

test('nothing outside a package is read, nothing past the bound, and Git installations are not browsed', async () => {
	const escaping = await types('escaping');
	assert.deepEqual(refused(escaping), [403, 'TYPES_ACCESS']);
	assert.match(escaping.body.error.message, /\.\.\/typed-lib\/index\.d\.ts/);
	const linked = await types('linked');
	assert.deepEqual(refused(linked), [403, 'TYPES_ACCESS']);
	assert.ok(!JSON.stringify(linked.body).includes('"packages"'), 'the file it links to is not answered');

	const huge = await types('huge');
	assert.deepEqual(refused(huge), [422, 'TYPES_UNSUPPORTED']);
	assert.equal(huge.body.error.limit, 1024 * 1024);
	const git = await types('git-lib');
	assert.deepEqual(refused(git), [422, 'TYPES_UNSUPPORTED']);
	assert.match(git.body.error.message, /installed from Git/);
});

test('a module of the esbuild packaging mode has no producer of declarations: the fixture module and the development runtime', async () => {
	for (const specifier of ['@types-fixture/packaged/main', '@beyond-js/local-2026/bundle']) {
		const answer = await types(specifier);
		assert.deepEqual(refused(answer), [404, 'DECLARATION_PRODUCER_MISSING'], `${specifier}: ${JSON.stringify(answer.body)}`);
		assert.deepEqual(answer.body.error.bundler, { name: 'esbuild', specifier: '@beyond-js/packages/bundlers/esbuild' });
		assert.match(answer.body.error.message, /has no "types" conditional/);
	}
	// The declaration route keeps its own answer for the same module
	const declaration = await served.send('GET', '/declarations/@types-fixture/packaged/main', { headers: served.headers });
	assert.deepEqual(refused(declaration), [404, 'DECLARATION_NOT_FOUND']);
});

test('a style module, a module that does not check and one the workspace does not publish', async () => {
	const theme = await types('@types-fixture/app/theme');
	assert.deepEqual(refused(theme), [422, 'TYPES_UNSUPPORTED']);
	assert.match(theme.body.error.message, /style module/);

	const broken = await types('@types-fixture/app/broken');
	assert.deepEqual(refused(broken), [422, 'DECLARATION_INVALID']);
	const located = broken.body.error.diagnostics.find(({ file }) => file === 'app/broken/index.ts');
	assert.ok(located, JSON.stringify(broken.body.error.diagnostics));
	assert.equal(located.range.line, 5);

	assert.deepEqual(refused(await types('@types-fixture/app/missing')), [404, 'DECLARATION_NOT_FOUND']);
	assert.deepEqual(refused(await types('@types-fixture/app@9.9.9/main')), [404, 'DECLARATION_NOT_FOUND']);
	assert.deepEqual(refused(await types('react@19.0.0')), [404, 'DECLARATION_NOT_FOUND']);
});

test('a request that names no public specifier, or no importer of the workspace, is refused by its code', async () => {
	const missing = await served.send('GET', '/types', { headers: served.headers });
	assert.deepEqual(refused(missing), [400, 'TYPES_REQUEST_INVALID']);
	assert.deepEqual(refused(await types('./main')), [400, 'TYPES_REQUEST_INVALID']);
	assert.deepEqual(refused(await types('@types-fixture/app/../secret')), [400, 'TYPES_REQUEST_INVALID']);
	assert.deepEqual(refused(await types('typed-lib', 'react > ')), [400, 'TYPES_REQUEST_INVALID']);
	assert.deepEqual(refused(await types('typed-lib', '@unknown/app')), [404, 'DECLARATION_NOT_FOUND']);
	assert.deepEqual(refused(await types('typed-lib', `${APP} > not-installed`)), [404, 'DECLARATION_NOT_FOUND']);
	for (const specifier of ['node:fs', 'fs', 'github:example/repository', 'https://archives.example.test/a.tgz']) {
		assert.deepEqual(refused(await types(specifier)), [422, 'TYPES_UNSUPPORTED'], specifier);
	}
});

test('type browsing is inspection: a local consumer, a page of another site and the preview listener are refused', async () => {
	const path = `/types?${new URLSearchParams({ specifier: 'typed-lib' })}`;
	assert.deepEqual(refused(await served.send('GET', path)), [401, 'CREDENTIAL_REQUIRED']);
	assert.deepEqual(refused(await served.send('GET', path, { headers: { origin: 'https://evil.example' } })), [401, 'PAIRING_REQUIRED']);
	assert.equal((await served.send('GET', path, { listener: served.session.service.preview })).status, 404);
});
