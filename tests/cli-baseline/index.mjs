/**
 * Baseline validation of what Packages provides for local execution: the artifact guarantees, the authoring
 * forms a package can use to declare its public modules and how selectors resolve, each observed from a
 * consumer process or from the public services. It is described in docs/local-cli-baseline.md.
 *
 * Every case writes its own temporary workspace, so this run never edits the suite testbed and needs no
 * watchers service. Run it like the stage-1 validation, from the Packages directory (the consumer resolves
 * the runtime from there):
 *
 * ```sh
 * BEE_URL=http://localhost:1112 node --import "$BEE_NODE_DIR/register.mjs" tests/cli-baseline/index.mjs
 * ```
 */
import { results } from '../stage-1/harness.mjs';
import { defects } from './defects.mjs';
import { declarations } from './declarations.mjs';
import { selection } from './selection.mjs';

const only = process.argv[2];
(!only || only === 'defects') && (await defects());
(!only || only === 'declarations') && (await declarations());
(!only || only === 'selection') && (await selection());

const failed = results.filter(result => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} steps passed`);
process.exit(failed.length ? 1 : 0);
