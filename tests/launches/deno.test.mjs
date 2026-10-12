import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Served } from './support/served.mjs';

/**
 * A Deno target launched by the real development service of this checkout with a real Deno 2 executable, named by
 * `BEYOND_DENO`: the service's Node import map, the module loading of its compiled outputs, the readiness, the answer
 * and the stop. Without a Deno 2 executable the case is reported as skipped, with the reason.
 */

const executable = process.env.BEYOND_DENO;

/**
 * Why the case cannot run here, or undefined when it can
 */
const unavailable = (() => {
	if (!executable) return 'BEYOND_DENO does not name a Deno 2 executable';
	if (!existsSync(executable)) return `BEYOND_DENO names ${executable}, which does not exist`;
	try {
		const version = execFileSync(executable, ['--version'], { encoding: 'utf8', timeout: 30000 });
		return /^deno 2\./.test(version) ? void 0 : `BEYOND_DENO is not Deno 2: ${version.split('\n')[0]}`;
	} catch (error) {
		return `BEYOND_DENO could not be run: ${error.message}`;
	}
})();

if (unavailable) {
	test('a Deno target is launched by the service with its import map, is ready, answers and stops', { skip: unavailable }, () => void 0);
} else {
	const served = new Served();
	before(() => served.start({ deno: executable }).catch(error => (console.error(served.log()), Promise.reject(error))), { timeout: 900000 });
	after(() => served.stop(), { timeout: 120000 });

	test('a Deno target is launched by the service with its import map, is ready, answers and stops', async () => {
		const created = await served.send('POST', '/launches', { body: { application: 'fixture', target: 'worker' }, key: 'request-0001' });
		assert.equal(created.status, 202, JSON.stringify(created.body));
		assert.deepEqual([created.body.launch.environment, created.body.launch.specifier], ['deno', '@launches/api/server']);
		const { id } = created.body.launch;

		const ready = await served.until(id, launch => ['ready', 'failed', 'exited'].includes(launch.state), 300000);
		const lines = (await served.send('GET', `/launches/${id}/output`)).body.lines.map(line => line.text);
		assert.equal(ready.state, 'ready', `${JSON.stringify(ready)}\n${lines.join('\n')}`);

		const address = /fixture API listening on (http:\/\/127\.0\.0\.1:\d+) \(deno\)/.exec(lines.join('\n'))?.[1];
		assert.ok(address, lines.join('\n'));
		const health = await (await fetch(`${address}/health`, { signal: AbortSignal.timeout(10000) })).json();
		assert.deepEqual([health.status, health.runtime], ['ready', 'deno']);
		assert.equal(existsSync(join(served.root, '.beyond', 'launches', 'deno')), true, 'the module cache is the workspace\'s');

		assert.equal((await served.send('POST', `/launches/${id}/stop`)).status, 202);
		const exited = await served.until(id, launch => ['exited', 'failed'].includes(launch.state), 30000);
		assert.deepEqual([exited.state, exited.exit.code], ['exited', 0]);
		assert.throws(() => process.kill(ready.pid, 0), { code: 'ESRCH' });
	});
}
