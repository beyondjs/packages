/**
 * Writes the browser build of the development runtime, as a CDN would deliver it, into a directory laid
 * out by the paths of the compiled-module contract: `<directory>/m/<name>@<version>/modules/<subpath>`.
 *
 * No Beyond CDN is hosted, and a preview of a project that does not contain the runtime asks the CDN for
 * it: its `bundle`, which the artifacts import, and its development coordinator `main`. A static origin
 * over this directory **stands in** for that CDN, and every result obtained with it says so. The modules
 * are compiled by the real service, for browsers, from the
 * runtime's sources; nothing here writes a module by hand. The development service produces development
 * output only, so the stand-in serves that build at the path a preview asks for, whatever the published
 * options of the request: production output is the CDN's, and this is not it.
 *
 *     BEYOND_ESBUILD=<fork checkout> BEE_URL=http://localhost:1112 WATCHERS_URL=http://localhost:1120 \
 *       node --import "$BEE_NODE_DIR/register.mjs" tests/preview/cdn.mjs <directory>
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Fork, Host, Runtime, Workspace } from './harness.mjs';

const { BEE_URL, WATCHERS_URL } = process.env;
if (!BEE_URL || !WATCHERS_URL) throw new Error('Set BEE_URL and WATCHERS_URL to the Engine servers of Packages and of the watchers utility.');
const [directory] = process.argv.slice(2);
if (!directory) throw new Error('Name the directory the stand-in CDN serves');

/** What the development service builds: development output for browsers. A CDN would build `env=production` */
const BUILT = 'target=browser&format=esm&env=development&min=false&sourcemap=inline&types=false&css=false';

const runtime = new Runtime();
const { name, version, exports } = JSON.parse(await readFile(join(runtime.root, 'package.json'), 'utf8'));
const workspace = await new Workspace().create(runtime);
const host = await new Host().start(workspace.root, { implementation: BEE_URL, watchers: WATCHERS_URL, BEYOND_ESBUILD_COMPILER: new Fork().file });

try {
	const written = [];
	for (const subpath of Object.keys(exports).map(entry => entry.replace(/^\.\//, ''))) {
		const path = `/m/${name}@${version}/modules/${subpath}`;
		const response = await fetch(`${host.origin}${path}?${BUILT}`);
		assert.equal(response.status, 200, `${path}: ${response.status} ${(await response.clone().text()).slice(0, 300)}`);
		const target = resolve(directory, `.${path}`);
		await mkdir(dirname(target), { recursive: true });
		await writeFile(target, Buffer.from(await response.arrayBuffer()));
		written.push(path);
	}
	await writeFile(resolve(directory, 'stand-in.json'), `${JSON.stringify({ standIn: true, runtime: { name, version }, built: BUILT, modules: written }, null, '\t')}\n`);
	console.log(`${written.length} modules of ${name}@${version} written to ${resolve(directory)}`);
} finally {
	await host.stop();
	await workspace.destroy();
}
