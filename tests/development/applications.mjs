import assert from 'node:assert/strict';
import { Project, step } from './harness.mjs';

const { Development } = await import('@beyond-js/packages/development');

/**
 * Stands for the hosting service's delivery of two local versions of `@case/api`, whose entry `./server` builds for
 * Node. `hanging` makes every build never settle, as a first build of a large entry can last longer than anyone waits.
 */
class Delivery {
	#hanging;
	#builds = 0;

	constructor({ hanging = false } = {}) {
		this.#hanging = hanging;
	}

	get builds() {
		return this.#builds;
	}

	async published() {
		return ['1.0.0', '2.0.0'].map(version => ({ name: '@case/api', version, subpath: './server', specifier: '@case/api/server', vspecifier: `@case/api@${version}/server` }));
	}

	module() {
		this.#builds++;
		return this.#hanging ? new Promise(() => void 0) : Promise.resolve({ failure: { code: 'BUILD_FAILED', message: 'not built by this stand-in' } });
	}
}

const DECLARATION = {
	applications: {
		site: {
			title: 'Site',
			targets: {
				api: { title: 'API', kind: 'backend', package: '@case/api', entry: './server', runtime: 'node', selection: '2.0.0' },
				any: { title: 'Any API', kind: 'backend', package: '@case/api', entry: './server', runtime: 'node' }
			}
		}
	}
};

/**
 * The catalog of applications resolving a target over a temporary root and the stand-in delivery, with the bound of
 * the builds it waits for set for the case
 */
const resolving = async (delivery, bound) => {
	const project = new Project({ 'beyond.json': JSON.stringify(DECLARATION) });
	const previous = process.env.BEYOND_TARGET_BUILD_TIMEOUT;
	process.env.BEYOND_TARGET_BUILD_TIMEOUT = String(bound);
	let development;
	try {
		development = new Development({ delivery, settings: { root: project.path } });
	} finally {
		previous === void 0 ? delete process.env.BEYOND_TARGET_BUILD_TIMEOUT : (process.env.BEYOND_TARGET_BUILD_TIMEOUT = previous);
	}
	await development.files.start();
	const stop = () => (development.stop(), project.remove());
	return { resolve: target => development.applications.resolve('site', target), stop };
};

export async function applications() {
	await step('target-build-bounded: an entry that is still being built when the bound passes is pending, not waited for', async () => {
		const delivery = new Delivery({ hanging: true });
		const context = await resolving(delivery, 300);
		const started = Date.now();
		const resolved = await context.resolve('api');
		const elapsed = Date.now() - started;
		assert.ok(elapsed < 3000, `answered in ${elapsed} ms`);
		assert.deepEqual(resolved.build, { platform: 'node', state: 'pending' });
		assert.deepEqual(resolved.diagnostics.map(({ code, severity }) => [code, severity]), [['TARGET_BUILD_PENDING', 'warning']]);
		assert.match(resolved.diagnostics[0].message, /after 300 ms \(BEYOND_TARGET_BUILD_TIMEOUT\)/);
		assert.equal(resolved.composition, void 0, 'the composition, which builds the graph, is not read while the entry builds');
		assert.deepEqual(resolved.launch, { supported: true, specifier: '@case/api@2.0.0/server' }, 'a pending build can be launched');
		context.stop();
		return `pending after ${elapsed} ms`;
	});

	await step('target-launch-specifier: of two local versions, a launch imports the versioned specifier the target selects', async () => {
		const context = await resolving(new Delivery(), 30000);
		const selected = await context.resolve('api');
		assert.deepEqual([selected.entry.specifier, selected.entry.vspecifier], ['@case/api/server', '@case/api@2.0.0/server']);
		assert.deepEqual(selected.launch, { supported: true, specifier: '@case/api@2.0.0/server' });
		assert.equal(selected.build.state, 'failed');

		const ambiguous = await context.resolve('any');
		assert.deepEqual(ambiguous.launch, { supported: false, reason: 'TARGET_AMBIGUOUS' });
		context.stop();
	});
}
