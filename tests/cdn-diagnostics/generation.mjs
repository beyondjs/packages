/**
 * The two capabilities side by side, on a live workspace: generation delivers a module whose types are wrong
 * and refuses one that does not parse, whether or not anybody requests the semantic check.
 */
import assert from 'node:assert/strict';
import { Workspace } from '@beyond-js/packages/workspace';
import { Delivery } from '@beyond-js/packages/artifacts';
import { Diagnostics } from '@beyond-js/packages/diagnostics';
import { step } from './harness.mjs';

const conditions = { platform: 'node' };

export async function generation(fixture) {
	const workspace = new Workspace(fixture.root);
	const delivery = new Delivery(workspace);
	const request = subpath => ({ name: '@fixture/app', version: '1.0.0', subpath });

	try {
		await step(
			'generation: a module with semantic errors is delivered, and the check is what reports them',
			async () => {
				const { delivered, failure } = await delivery.module(request('./broken'), conditions);
				assert.equal(failure, undefined);
				assert.match(delivered.code('none'), /'text'/);

				await workspace.ready;
				const pkg = [...workspace.packages.values()].find(one => one.name === '@fixture/app');
				const module = await Diagnostics.module(pkg, './broken');
				assert.deepEqual(module, fixture.module('broken', { path: 'broken' }));

				const result = fixture.observe(await Diagnostics.check({ module, conditions }));
				assert.deepEqual(result.diagnostics.map(({ code }) => code).sort(), ['TS2322', 'TS2345']);
				assert.equal(await Diagnostics.module(pkg, './missing'), undefined);
				return 'Delivery.module() built it; Diagnostics.module() described it; the check found TS2322 and TS2345';
			}
		);

		await step(
			'generation: the essential error of a module that does not parse comes from generation itself',
			async () => {
				const { delivered, failure } = await delivery.module(request('./syntax'), conditions);
				assert.equal(delivered, undefined);
				assert.equal(failure.code, 'BUILD_FAILED');
				assert.ok(failure.diagnostics.some(({ code }) => code === 'TRANSPILE_ERROR'));
				return `BUILD_FAILED: ${failure.diagnostics[0].message}`;
			}
		);
	} finally {
		workspace.destroy();
	}
}
