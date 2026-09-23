/**
 * Validation of the semantic TypeScript diagnostics of Packages (`@beyond-js/packages/diagnostics`).
 *
 * It establishes what separates the capability from generation: the per-file transformation accepts code
 * whose types are wrong, and the check reports it with the file relative to the package, the range and the
 * compiler code. It also checks how the types of public dependencies are supplied, that missing types are a
 * category of their own instead of errors of the module, that a check is bounded and cancellable, and that
 * no result describes the host. The packages are a temporary copy of `fixtures/workspace`; nothing of the
 * repository is edited.
 *
 * Run it under BEE Node with a bootstrap Engine serving the implementation; read the local README.
 */
import { Fixture, results } from './harness.mjs';
import { semantic } from './semantic.mjs';
import { dependencies } from './dependencies.mjs';
import { generation } from './generation.mjs';
import { bounds } from './bounds.mjs';

const fixture = await new Fixture().create();

try {
	await semantic(fixture);
	await dependencies(fixture);
	await generation(fixture);

	// Last, because it verifies what every result observed until then discloses
	await bounds(fixture);
} finally {
	await fixture.destroy();
}

const failed = results.filter(result => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
