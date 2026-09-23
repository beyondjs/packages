/**
 * The development HTTP adapter serving the companion resource families of the compiled-module contract:
 * the stylesheet of a packaged module and the static files its package declares. The module route is
 * checked to answer exactly what the delivery compiles, and the conformance rules of the contract run
 * against the live routes.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Options } from '@beyond-js/artifact-api';
import { Service } from '@beyond-js/artifact-api/conformance';
import { Workspace } from '@beyond-js/packages/workspace';
import { Delivery } from '@beyond-js/packages/artifacts';
import { Routes } from '@beyond-js/packages/http/routes';

/**
 * The workspace of `fixtures/served`: one package, `@fixture/served`, whose modules are packaged by the esbuild
 * bundler. `./card` imports a stylesheet that references a logo its manifest declares, beside a file it does
 * not declare; `./plain` has no stylesheet; `./broken` does not parse, on purpose. Read the local README.
 */
export class Served {
	static FIXTURE = fileURLToPath(new URL('./fixtures/served/', import.meta.url));

	/**
	 * Copies the fixture into a new temporary directory. The one substitution is the compiler the bundle
	 * processor selects, written into the copied manifest; the checked-in manifest names `esbuild`.
	 *
	 * @returns The root of the copy
	 */
	static async create(compiler) {
		const root = await realpath(await mkdtemp(join(tmpdir(), 'beyond-cdn-delivery-')));
		await cp(Served.FIXTURE, root, { recursive: true });

		const manifest = join(root, 'ui/package.json');
		const value = JSON.parse(await readFile(manifest, 'utf8'));
		value.bundlers.esbuild.processors.bundle.compiler = compiler;
		await writeFile(manifest, JSON.stringify(value));
		return root;
	}
}

export class Delivered {
	#report;
	#compiler;

	constructor(report, compiler) {
		this.#report = report;
		this.#compiler = compiler;
	}

	async run() {
		const svg = await readFile(join(Served.FIXTURE, 'ui/card/logo.svg'), 'utf8');
		const root = await Served.create(this.#compiler);
		const workspace = new Workspace(root);
		const delivery = new Delivery(workspace);
		const app = express();
		Routes.setup(app, delivery);
		Routes.errors(app);
		const server = await new Promise(resolve => {
			const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
		});
		const origin = `http://127.0.0.1:${server.address().port}`;
		const query = new URLSearchParams(Options.development).toString();
		const get = path => fetch(`${origin}${path}`);
		const prefix = '/m/@fixture/served@1.0.0';

		try {
			await this.#report.step('http: the module route answers exactly what the delivery compiles, as before the new families', async () => {
				const response = await get(`${prefix}/modules/card?${query}`);
				const body = await response.text();
				const { delivered } = await delivery.module({ name: '@fixture/served', version: '1.0.0', subpath: './card' }, new Options(new URLSearchParams(query)).conditions);
				assert.equal(response.status, 200);
				assert.equal(body, delivered.code('inline'));
				assert.equal(response.headers.get('etag'), `"sha256-${createHash('sha256').update(body).digest('hex')}"`);
				assert.deepEqual([response.headers.get('cache-control'), response.headers.get('link'), response.headers.get('sourcemap')], ['no-store', null, null]);
				assert.ok(!body.includes('.card {'), 'Styles are not injected into the code');
				return `${body.length} bytes, identical to Delivery.module`;
			});

			await this.#report.step('http: /styles/ and /assets/ serve the stylesheet and the declared logo; the rest is OUTPUT_NOT_AVAILABLE', async () => {
				const styles = await get(`${prefix}/styles/card?${query}`);
				const css = await styles.text();
				assert.deepEqual([styles.status, styles.headers.get('content-type'), styles.headers.get('cache-control')], [200, 'text/css; charset=utf-8', 'no-store']);
				assert.ok(css.includes('url(../assets/card/logo.svg)'), css);

				// The reference of the stylesheet, resolved against its own address, is the address of the asset
				const address = new URL('../assets/card/logo.svg', `${origin}${prefix}/styles/card?${query}`);
				assert.equal(address.pathname, `${prefix}/assets/card/logo.svg`);
				const logo = await fetch(address);
				assert.deepEqual([logo.status, logo.headers.get('content-type'), await logo.text()], [200, 'image/svg+xml', svg]);

				const code = async path => [(await get(path)).status, (await (await get(path)).json()).error.code];
				assert.deepEqual(await code(`${prefix}/styles/plain?${query}`), [404, 'OUTPUT_NOT_AVAILABLE']);
				assert.deepEqual(await code(`${prefix}/assets/card/secret.txt`), [404, 'OUTPUT_NOT_AVAILABLE']);
				assert.deepEqual(await code(`${prefix}/assets/package.json`), [404, 'OUTPUT_NOT_AVAILABLE']);
				assert.deepEqual(await code(`${prefix}/maps/card?${query}`), [404, 'OUTPUT_NOT_AVAILABLE']);
				assert.deepEqual(await code(`${prefix}/styles/absent?${query}`), [404, 'MODULE_NOT_FOUND']);
				assert.deepEqual(await code(`${prefix}/assets/card/logo.svg?${query}`), [400, 'OPTION_INVALID']);
				return 'text/css with ../assets/ reference, image/svg+xml; undeclared file, module without styles and external map refused';
			});

			await this.#report.step('http: an error answer carries no ETag and is no-store, for every status and family; artifact answers keep their validators', async () => {
				const failures = {
					'400 OPTION_INVALID': `${prefix}/modules/card?format=esm`,
					'400 OPTION_UNSUPPORTED': `${prefix}/modules/card?${query.replace('format=esm', 'format=cjs')}`,
					'404 MODULE_NOT_FOUND': `${prefix}/modules/absent?${query}`,
					'404 PACKAGE_NOT_FOUND': `/m/@fixture/absent@1.0.0/modules/card?${query}`,
					'404 VERSION_MISMATCH': `/m/@fixture/served@9.9.9/modules/card?${query}`,
					'404 OUTPUT_NOT_AVAILABLE': `${prefix}/assets/card/secret.txt`,
					'422 BUILD_FAILED': `${prefix}/modules/broken?${query}`,
					'501 SOURCE_UNSUPPORTED': `/m/digest/sha256-${'0'.repeat(64)}/modules/main?${query}`
				};
				for (const [expected, path] of Object.entries(failures)) {
					// A conditional request must not turn an error into a validated answer either
					const response = await fetch(`${origin}${path}`, { headers: { 'If-None-Match': '*' } });
					const text = await response.text();
					const { error } = JSON.parse(text);
					assert.equal(`${response.status} ${error.code}`, expected);
					assert.equal(response.headers.get('etag'), null, `${expected} has no ETag`);
					assert.equal(response.headers.get('cache-control'), 'no-store', expected);
					assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8', expected);
					assert.equal(Number(response.headers.get('content-length')), Buffer.byteLength(text), expected);
				}
				assert.ok(JSON.parse(await (await get(failures['422 BUILD_FAILED'])).text()).error.diagnostics.length, 'The build diagnostics are in the body');

				for (const path of [`${prefix}/modules/card?${query}`, `${prefix}/styles/card?${query}`, `${prefix}/assets/card/logo.svg`]) {
					const response = await get(path);
					const body = Buffer.from(await response.arrayBuffer());
					assert.equal(response.headers.get('etag'), `"sha256-${createHash('sha256').update(body).digest('hex')}"`, path);
					const current = await fetch(`${origin}${path}`, { headers: { 'If-None-Match': response.headers.get('etag') } });
					assert.deepEqual([current.status, current.headers.get('etag')], [304, response.headers.get('etag')], path);
				}
				return `${Object.keys(failures).length} error answers without validators (${Object.keys(failures).join(', ')}); 200 and 304 keep strong ETags`;
			});

			await this.#report.step('http: the conformance rules of the contract pass, companion families included', async () => {
				const module = { name: '@fixture/served', version: '1.0.0', subpath: './card' };
				const outcomes = await new Service(origin, module, { registers: false }, { style: true, asset: 'card/logo.svg' }).run();
				const failed = outcomes.filter(({ ok }) => !ok);
				assert.deepEqual(failed.map(({ name, detail }) => `${name}: ${detail}`), []);
				return `${outcomes.length}/${outcomes.length} rules`;
			});
		} finally {
			await new Promise(resolve => server.close(resolve));
			workspace.destroy();
			await rm(root, { recursive: true, force: true });
		}
	}
}
