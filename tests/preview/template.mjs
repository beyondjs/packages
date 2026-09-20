/**
 * Validates a project created from the Workspace template with an installed toolchain, the way a person
 * follows the README and the AGENTS.md that the template ships: the command of the README starts the
 * development service, the preview renders in a browser, the project is extended with a sibling package as
 * its instructions say, and the two artifacts stay independent. It runs in a plain Node process: everything
 * that compiles is the installed toolchain.
 *
 * ```sh
 * BEYOND_TEMPLATE=<template checkout> BEYOND_TOOLCHAIN=<installation directory> BEYOND_PLAYWRIGHT=<directory> \
 *   node tests/preview/template.mjs
 * ```
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Browser, Origin } from './browser.mjs';

const { BEYOND_TEMPLATE, BEYOND_TOOLCHAIN } = process.env;
if (!BEYOND_TEMPLATE || !BEYOND_TOOLCHAIN) throw new Error('Set BEYOND_TEMPLATE to the template checkout and BEYOND_TOOLCHAIN to an installed toolchain.');

const results = [];
const step = async (name, fn) => {
	try {
		const notes = await fn();
		results.push(true);
		console.log(`PASS ${name}${notes ? ` — ${notes}` : ''}`);
	} catch (error) {
		results.push(false);
		console.log(`FAIL ${name}\n${error.stack}`);
	}
};

/**
 * The `beyond run` of the README, started in the project and stopped with the interruption the README names
 */
class Server {
	#process;
	#output = '';
	endpoint;

	get output() {
		return this.#output;
	}

	async start(cwd, env) {
		const bin = join(resolve(BEYOND_TOOLCHAIN), 'node_modules', '.bin', 'beyond');
		this.#process = spawn(bin, ['run'], { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
		[this.#process.stdout, this.#process.stderr].forEach(stream => stream.setEncoding('utf8').on('data', chunk => (this.#output += chunk)));

		for (const deadline = Date.now() + 120000; Date.now() < deadline; await new Promise(done => setTimeout(done, 200))) {
			this.endpoint = /endpoint\s+(http:\/\/\S+)/.exec(this.#output)?.[1];
			if (this.endpoint) return this;
			if (this.#process.exitCode !== null) break;
		}
		throw new Error(`The development server did not start:\n${this.#output}`);
	}

	async stop() {
		if (!this.#process || this.#process.exitCode !== null) return;
		const exited = new Promise(done => this.#process.once('exit', done));
		this.#process.kill('SIGINT');
		await Promise.race([exited, new Promise(done => setTimeout(done, 20000))]);
		this.#process.exitCode === null && this.#process.kill('SIGKILL');
	}
}

const cleanup = [];
const root = await realpath(await mkdtemp(join(tmpdir(), 'beyond-template-')));
const project = join(root, 'project');
cleanup.push(() => rm(root, { recursive: true, force: true }));

const json = async (file, mutate) => {
	const value = JSON.parse(await readFile(file, 'utf8'));
	mutate(value);
	await writeFile(file, `${JSON.stringify(value, null, '\t')}\n`);
};
const files = async directory => (await readdir(directory, { recursive: true, withFileTypes: true })).filter(entry => entry.isFile()).map(entry => join(entry.parentPath, entry.name));
const development = 'target=browser&format=esm&env=development&min=false&sourcemap=none&types=false&css=false';

let server, cdn, browser, kernel;
const get = async path => {
	const response = await fetch(`${server.endpoint}${path}`);
	const text = await response.text();
	return { status: response.status, etag: response.headers.get('etag'), text, json: () => JSON.parse(text) };
};
const open = async () => {
	const { page, observed } = await browser.page();
	await page.goto(`${server.endpoint}/preview/`);
	await page.waitForSelector('app-welcome');
	return { page, observed };
};

try {
	await step('fresh project: a copy of the template outside every checkout, with nothing that names one', async () => {
		await cp(resolve(BEYOND_TEMPLATE), project, { recursive: true, filter: source => !source.split('/').includes('.git') });
		const shipped = await files(project);
		for (const name of ['README.md', 'AGENTS.md', '.gitignore', 'beyond.json', 'template.json']) assert.ok(shipped.includes(join(project, name)), name);

		const forbidden = [resolve(BEYOND_TEMPLATE, '..'), homedir(), 'beyond-suite', 'feature/next', '](../', 'docs-temp'];
		for (const file of shipped) {
			const text = await readFile(file, 'utf8');
			for (const value of forbidden) assert.ok(!text.includes(value), `${file.slice(project.length + 1)} contains "${value}"`);
		}
		return `${shipped.length} files`;
	});

	await step('README: `beyond run` with the development extension compiles and serves the application', async () => {
		kernel = JSON.parse(await readFile(join(resolve(BEYOND_TOOLCHAIN), 'node_modules/@beyond-js/kernel/package.json'), 'utf8')).version;
		const code = await readFile(join(resolve(BEYOND_TOOLCHAIN), 'node_modules/@beyond-js/kernel/bundle/bundle.browser.mjs'), 'utf8');
		cdn = await new Origin().module(`/m/@beyond-js/kernel@${kernel}/modules/bundle`, code).start();
		cleanup.push(() => cdn.stop());

		await mkdir(join(root, 'home'));
		server = await new Server().start(project, {
			BEYOND_HOME: join(root, 'home'), BEYOND_SERVICE_EXTENSIONS: '@beyond-js/packages/development', BEYOND_CDN_ORIGIN: cdn.origin
		});
		cleanup.push(() => server.stop());

		const state = (await get('/state')).json();
		assert.deepEqual(state.modules.map(({ specifier, status }) => [specifier, status]), [['@project/app/main', 'valid']]);
		const entry = (await get('/preview/entry.json')).json();
		assert.deepEqual(entry.diagnostics, []);
		assert.deepEqual(entry.modules.map(({ specifier, source, version }) => [specifier, source, version]),
			[['@beyond-js/kernel/bundle', 'cdn', kernel], ['@project/app/main', 'environment', '0.1.0']]);
		assert.ok(entry.updates.reason, 'Nothing applies updates to the running page, and the description says so');

		const artifact = await get(`/m/@project/app@0.1.0/modules/main?${development}`);
		assert.equal(artifact.status, 200);
		return `${server.endpoint}; Kernel ${kernel} from the stand-in CDN`;
	});

	await step('browser: the element, its texts and its styles render, and its state works', async () => {
		browser = await new Browser().start();
		cleanup.push(() => browser.stop());

		const { page, observed } = await open();
		assert.equal(await page.locator('app-welcome h1').textContent(), 'Hello, Beyond');
		const style = await page.locator('app-welcome button').evaluate(button => getComputedStyle(button).backgroundColor);
		assert.equal(style, 'rgb(30, 64, 175)');
		await page.locator('app-welcome button').click();
		assert.equal(await page.locator('app-welcome output').textContent(), '1 click');
		assert.deepEqual([observed.errors, observed.refused], [[], []]);
		await page.close();
		return `${browser.version}`;
	});

	await step('edit: a saved source is in the next load of the preview; the running page is not updated, as the README says', async () => {
		const { page } = await open();
		const file = join(project, 'packages/app/main/texts.ts');
		await writeFile(file, (await readFile(file, 'utf8')).replace("'Hello, Beyond'", "'Hello, edited'"));

		for (const deadline = Date.now() + 30000; !(await get(`/m/@project/app@0.1.0/modules/main?${development}`)).text.includes('Hello, edited'); ) {
			if (Date.now() > deadline) throw new Error('The edit was not rebuilt');
			await new Promise(done => setTimeout(done, 200));
		}
		await new Promise(done => setTimeout(done, 2000));
		assert.equal(await page.locator('app-welcome h1').textContent(), 'Hello, Beyond', 'No update is applied to the running page');
		await page.reload();
		await page.waitForSelector('app-welcome');
		assert.equal(await page.locator('app-welcome h1').textContent(), 'Hello, edited');
		await page.close();
		return 'rebuilt on save, shown on reload: this is not HMR';
	});

	await step('AGENTS.md: a sibling package with a public module, imported by its bare specifier', async () => {
		await mkdir(join(project, 'packages/shared/text'), { recursive: true });
		await writeFile(join(project, 'packages/shared/package.json'), `${JSON.stringify({
			name: '@project/shared', version: '0.1.0', private: true, exports: { './text': './text/index.ts' },
			dependencies: {}, beyond: { modules: '.', bundler: 'ts' }, bundlers: { ts: '@beyond-js/packages/bundlers/ts' }
		}, null, '\t')}\n`);
		await writeFile(join(project, 'packages/shared/text/module.json'), '{\n\t"platforms": ["web"]\n}\n');
		await writeFile(join(project, 'packages/shared/text/index.ts'), "export const greeting = (name: string): string => `Hello from shared, ${name}`;\n");
		await json(join(project, 'beyond.json'), value => value.packages.push('packages/shared'));
		await json(join(project, 'packages/app/package.json'), value => (value.dependencies['@project/shared'] = '0.1.0'));

		const texts = join(project, 'packages/app/main/texts.ts');
		const source = await readFile(texts, 'utf8');
		await writeFile(texts, `import { greeting } from '@project/shared/text';\n\n${source.replace("'Hello, edited'", "greeting('Beyond')")}`);

		const entry = (await get('/preview/entry.json')).json();
		assert.deepEqual(entry.diagnostics, []);
		assert.deepEqual(entry.modules.map(({ specifier, source: from }) => [specifier, from]),
			[['@beyond-js/kernel/bundle', 'cdn'], ['@project/app/main', 'environment'], ['@project/shared/text', 'environment']]);

		const app = await get(`/m/@project/app@0.1.0/modules/main?${development}`);
		assert.match(app.text, /from '@project\/shared\/text'/, 'The bare public import is preserved');
		assert.ok(!app.text.includes('Hello from shared'), 'The other package is not inlined');

		const { page, observed } = await open();
		assert.equal(await page.locator('app-welcome h1').textContent(), 'Hello from shared, Beyond');
		assert.deepEqual([observed.errors, observed.refused], [[], []]);
		await page.close();
	});

	await step('independence: editing the sibling package changes its artifact and leaves the application artifact as it was', async () => {
		const address = name => `/m/@project/${name}?${development}`;
		const before = { app: (await get(address('app@0.1.0/modules/main'))).etag, shared: (await get(address('shared@0.1.0/modules/text'))).etag };

		const file = join(project, 'packages/shared/text/index.ts');
		await writeFile(file, (await readFile(file, 'utf8')).replace('Hello from shared', 'Greetings from shared'));
		for (const deadline = Date.now() + 30000; (await get(address('shared@0.1.0/modules/text'))).etag === before.shared; ) {
			if (Date.now() > deadline) throw new Error('The edit of the sibling package was not rebuilt');
			await new Promise(done => setTimeout(done, 200));
		}
		assert.equal((await get(address('app@0.1.0/modules/main'))).etag, before.app);

		const { page } = await open();
		assert.equal(await page.locator('app-welcome h1').textContent(), 'Greetings from shared, Beyond');
		await page.close();
	});

	await step('diagnostics: an undeclared dependency and a source error are reported by the preview and the state, and no stale output is served', async () => {
		await json(join(project, 'packages/app/package.json'), value => delete value.dependencies['@project/shared']);
		const undeclared = (await get('/preview/entry.json')).json();
		assert.equal(undeclared.entry.specifier, '@project/app/main', 'The entry is still the application');
		assert.ok(undeclared.diagnostics.some(({ code }) => code === 'DEPENDENCY_NOT_DECLARED'), JSON.stringify(undeclared.diagnostics));
		await json(join(project, 'packages/app/package.json'), value => (value.dependencies['@project/shared'] = '0.1.0'));
		assert.deepEqual((await get('/preview/entry.json')).json().diagnostics, []);

		const file = join(project, 'packages/app/main/clicks.ts');
		const valid = await readFile(file, 'utf8');
		await writeFile(file, 'export class Clicks { #value = ; }\n');
		let broken;
		for (const deadline = Date.now() + 30000; !(broken = (await get('/preview/entry.json')).json()).diagnostics.length; ) {
			if (Date.now() > deadline) throw new Error('The source error was not reported');
			await new Promise(done => setTimeout(done, 200));
		}
		const state = (await get('/state')).json().modules.find(({ specifier }) => specifier === '@project/app/main');
		assert.equal(state.status, 'invalid');
		assert.equal((await get(`/m/@project/app@0.1.0/modules/main?${development}`)).status, 422);

		await writeFile(file, valid);
		for (const deadline = Date.now() + 30000; (await get('/preview/entry.json')).json().diagnostics.length; ) {
			if (Date.now() > deadline) throw new Error('The correction was not rebuilt');
			await new Promise(done => setTimeout(done, 200));
		}
		return `reported as ${broken.diagnostics.map(({ code }) => code).join(', ')}`;
	});

	await step('selection: the commands of the README replace and clear it, and a package that is not selected is asked of the CDN', async () => {
		const call = async (method, body) => (await fetch(`${server.endpoint}/development/selection`, { method, body })).json();
		assert.deepEqual(await call('PUT', '{"packages":["@project/app"]}'), { explicit: true, packages: ['@project/app'], modules: [], unknown: [] });

		const shared = (await get('/preview/entry.json')).json().modules.find(({ specifier }) => specifier === '@project/shared/text');
		assert.deepEqual([shared.source, shared.version, shared.url.startsWith(`${cdn.origin}/m/@project/shared@0.1.0/modules/text?`)], ['cdn', '0.1.0', true]);
		assert.deepEqual((await readFile(join(project, '.beyond/.gitignore'), 'utf8')), '*\n');

		assert.equal((await call('DELETE')).explicit, false);
		await rm(join(project, '.beyond'), { recursive: true });
	});

	await step('README: `beyond run <module>` executes Node modules, so it refuses the browser module with its reason', async () => {
		const bin = join(resolve(BEYOND_TOOLCHAIN), 'node_modules', '.bin', 'beyond');
		const child = spawn(bin, ['run', '@project/app/main'], { cwd: project, env: { ...process.env, BEYOND_HOME: join(root, 'home') }, stdio: ['ignore', 'pipe', 'pipe'] });
		let output = '';
		[child.stdout, child.stderr].forEach(stream => stream.setEncoding('utf8').on('data', chunk => (output += chunk)));
		const code = await new Promise(done => child.once('exit', done));
		assert.equal(code, 1);
		assert.match(output, /CONDITIONAL_NOT_FOUND|does not produce the "node/);
		return output.trim().split('\n').at(-1).slice(0, 160);
	});

	await step('stop: interrupting the command ends the server, and the project holds no generated file besides the ignored state', async () => {
		await server.stop();
		await assert.rejects(fetch(`${server.endpoint}/session`));
		const remaining = (await files(project)).map(file => file.slice(project.length + 1)).filter(file => file.startsWith('.beyond') || file.includes('node_modules'));
		assert.deepEqual(remaining, []);
	});
} finally {
	results.includes(false) && server && console.log(`--- beyond run ---\n${server.output.slice(-2000)}`);
	for (const task of cleanup.reverse()) await Promise.resolve().then(task).catch(error => console.log(`cleanup: ${error.message}`));
}

console.log(`\n${results.filter(ok => ok).length}/${results.length} steps passed`);
process.exit(results.includes(false) ? 1 : 0);
