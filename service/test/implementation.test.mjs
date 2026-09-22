import test from 'node:test';
import assert from 'node:assert/strict';
import { Implementation } from '../implementation.mjs';
import { Installation } from '../installation.mjs';

test('this checkout carries sources, so its implementation needs the bootstrap', async t => {
	const installation = new Installation();
	assert.equal(installation.compiled, false);
	assert.match(installation.runtime.base, /^file:.*package\.json$/);
	assert.match(installation.id, /^[0-9a-f]{16}$/);

	/**
	 * The transitional bootstrap is `bootstrap/` of this repository, installed beside Packages by the command
	 * line's installer. It depends on Packages itself, so the lockfile of this checkout cannot record it: a
	 * checkout links it by hand (`ln -s ../../bootstrap node_modules/@beyond-js/packages-bootstrap`) to run
	 * this case, and an installation is accepted by the command line's acceptance.
	 */
	let linked = true;
	await import(Implementation.BOOTSTRAP).catch(error => (linked = error.code !== 'ERR_MODULE_NOT_FOUND'));
	if (!linked) return t.skip('the bootstrap is not linked beside this checkout');

	const provider = await Implementation.provider(installation);
	assert.equal(provider.constructor.name, 'Bootstrap');
});

test('a compiled distribution is started as an ordinary Node process, with nothing prepared', async () => {
	const packages = { path: '/installed/@beyond-js/packages' };
	const provider = await Implementation.provider({ compiled: true, packages });

	assert.deepEqual(await provider.prepare({ directory: '/unused', log: '/unused' }), {
		execArgv: [],
		env: {},
		cwd: packages.path,
		watchers: { env: {}, cwd: packages.path },
		groups: [],
		versions: {}
	});
	await provider.stop();
});

test('sources without the bootstrap package are explained, not guessed around', async t => {
	const original = Implementation.BOOTSTRAP;
	Implementation.BOOTSTRAP = '@beyond-js/packages-bootstrap-that-is-not-installed';
	t.after(() => (Implementation.BOOTSTRAP = original));

	await assert.rejects(Implementation.provider({ compiled: false }), /carries sources.*is not installed beside it/s);
});
