/**
 * The dependency graph as an object model: what its flags mean and how occurrences are registered. These
 * are the contracts the installer of a local project relies on.
 */
import assert from 'node:assert/strict';
import { DependenciesGraph } from '@beyond-js/packages/dependencies/graph';
import { PackageProviders, Metadata } from '@beyond-js/packages/providers';
import { step } from './harness.mjs';

const project = (registry, dependencies) => ({
	name: 'structure-app',
	version: '1.0.0',
	processed: true,
	ready: Promise.resolve(),
	dependencies: { spec: dependencies },
	packages: new Metadata(
		new PackageProviders({
			user: false,
			global: false,
			env: false,
			values: { default: { registry: registry.url } }
		})
	)
});

export async function structure({ registry }) {
	await step('completion: a failed occurrence is processed, and never a completed closure', async () => {
		const dependencies = { dependencies: { 'range-user': '1.0.0', 'cycle-a': '^1.0.0' } };
		const graph = new DependenciesGraph(project(registry, dependencies));
		await graph.process({ update: false });

		assert.equal(graph.processed, true);
		assert.equal(graph.processing, false);
		assert.equal(graph.dependencies.settled, true);
		assert.equal(graph.dependencies.completed, false);
		assert.equal(graph.completed, false);
		assert.deepEqual(
			graph.closure.errors.map(({ id, error }) => `${id}:${error.code}`),
			['#>range-user>diamond-base:VERSION_UNRESOLVED']
		);

		const failed = graph.dependencies.get('range-user').dependencies.get('diamond-base');
		assert.equal(failed.processed, true);
		assert.equal(failed.error.code, 'VERSION_UNRESOLVED');
	});

	await step('occurrences: repeated packages keep their own identity in the registry', async () => {
		const dependencies = { dependencies: { 'diamond-top': '1.0.0' }, devDependencies: { 'multi-old': '1.0.0' } };
		const graph = new DependenciesGraph(project(registry, dependencies), { development: true });
		await graph.process({ update: false });
		assert.equal(graph.completed, true);

		const { nodes, packages } = graph.registry;
		const occurrences = [...nodes.values()].filter(node => node.package === 'diamond-base');
		assert.deepEqual(occurrences.map(({ id }) => id).sort(), [
			'#>diamond-top>diamond-left>diamond-base',
			'#>diamond-top>diamond-right>diamond-base',
			'#>multi-old>diamond-base'
		]);
		assert.equal(packages.get('semver:diamond-base').nodes.semver.groups.length, 1);
		assert.equal(packages.get('semver:diamond-base').nodes.semver.groups[0].chosen, '1.2.5');

		// Unregistering uses the key registering used: one occurrence leaves, the others stay
		const size = nodes.size;
		nodes.unregister(occurrences[0]);
		nodes.unregister(occurrences[0]);
		assert.equal(nodes.size, size - 1);
		assert.ok(packages.has('semver:diamond-base'));
		nodes.unregister(occurrences[1]);
		nodes.unregister(occurrences[2]);
		assert.ok(!packages.has('semver:diamond-base'));
	});

	await step('update: ignoring the lock selects the newest releases', async () => {
		const dependencies = { dependencies: { 'diamond-base': '^1.0.0' } };
		const lock = [{ name: 'diamond-base', version: '1.2.0' }];
		const locked = new DependenciesGraph(project(registry, dependencies), { lock });
		await locked.process({ update: false });
		assert.equal(locked.dependencies.get('diamond-base').version.resolved, '1.2.0');

		await locked.process({ update: true });
		assert.equal(locked.dependencies.get('diamond-base').version.resolved, '1.3.0');
	});
}
