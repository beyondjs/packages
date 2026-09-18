import test from 'node:test';
import assert from 'node:assert/strict';
import { Implementation } from '../implementation.mjs';
import { Installation } from '../installation.mjs';

test('this checkout carries sources, so its implementation needs the bootstrap', async () => {
	const installation = new Installation();
	assert.equal(installation.compiled, false);
	assert.match(installation.runtime.base, /^file:.*package\.json$/);
	assert.match(installation.id, /^[0-9a-f]{16}$/);

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
