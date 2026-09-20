/**
 * The development HTTP adapter serving the companion resource families of the compiled-module contract:
 * the stylesheet of a packaged module and the static files its package declares. The module route is
 * checked to answer exactly what the delivery compiles, and the conformance rules of the contract run
 * against the live routes.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import express from 'express';
import { Options } from '@beyond-js/artifact-api';
import { Service } from '@beyond-js/artifact-api/conformance';
import { Workspace } from '@beyond-js/packages/workspace';
import { Delivery } from '@beyond-js/packages/artifacts';
import { Routes } from '@beyond-js/packages/http/routes';

const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>\n`;

export class Delivered {
	#report;
	#compiler;

	constructor(report, compiler) {
		this.#report = report;
		this.#compiler = compiler;
	}

	/**
	 * A workspace with one package whose module is packaged by the esbuild bundler, imports a stylesheet
	 * that references a declared logo, and declares that logo in its manifest
	 */
	async #workspace() {
		const root = await realpath(await mkdtemp(join(tmpdir(), 'beyond-cdn-delivery-')));
		const processors = { bundle: { compiler: this.#compiler } };
		const files = {
			'beyond.json': JSON.stringify({ packages: ['ui'] }),
			'ui/package.json': JSON.stringify({
				name: '@fixture/served', version: '1.0.0', exports: { './card': './card/index.ts', './plain': './plain/index.ts', './broken': './broken/index.ts' },
				beyond: { modules: '.', bundler: 'esbuild' },
				bundlers: { esbuild: { specifier: '@beyond-js/packages/bundlers/esbuild', processors } }
			}),
			'ui/card/module.json': JSON.stringify({ platforms: ['web', 'node'], assets: ['logo.svg'] }),
			'ui/card/index.ts': `import './card.css';\nexport const card: string = 'card';\n`,
			'ui/card/card.css': `.card { background: url(./logo.svg); }\n`,
			'ui/card/logo.svg': LOGO,
			'ui/card/secret.txt': 'not declared',
			'ui/plain/module.json': JSON.stringify({ platforms: ['web', 'node'] }),
			'ui/plain/index.ts': `export const plain: string = 'plain';\n`,
			'ui/broken/module.json': JSON.stringify({ platforms: ['web', 'node'] }),
			'ui/broken/index.ts': `export const broken = ;\n`
		};
		for (const [file, content] of Object.entries(files)) {
			await mkdir(dirname(join(root, file)), { recursive: true });
			await writeFile(join(root, file), content);
		}
		return root;
	}

	async run() {
		const root = await this.#workspace();
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
				assert.deepEqual([logo.status, logo.headers.get('content-type'), await logo.text()], [200, 'image/svg+xml', LOGO]);

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
					'400 OPTION_UNSUPPORTED': `${prefix}/modules/card?${query.replace('format=esm', 'format=system')}`,
					'404 MODULE_NOT_FOUND': `${prefix}/modules/absent?${query}`,
					'404 PACKAGE_NOT_FOUND': `/m/@fixture/absent@1.0.0/modules/card?${query}`,
					'404 VERSION_MISMATCH': `/m/@fixture/served@9.9.9/modules/card?${query}`,
					'404 OUTPUT_NOT_AVAILABLE': `${prefix}/assets/card/secret.txt`,
					'422 BUILD_FAILED': `${prefix}/modules/broken?${query}`,
					'501 SOURCE_UNSUPPORTED': `/m/digest/sha256-00/modules/main?${query}`
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
