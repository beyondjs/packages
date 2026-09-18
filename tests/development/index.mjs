/**
 * Validation of the development contract against its real implementation, `@beyond-js/packages/development`.
 * Every case writes its own temporary root. Run it from the Packages directory, like the other validations:
 *
 * ```sh
 * BEE_URL=http://localhost:1112 node --import "$BEE_NODE_DIR/register.mjs" tests/development/index.mjs [group]
 * ```
 */
import { results } from './harness.mjs';

const groups = { files: './files.mjs', service: './service.mjs' };
const only = process.argv[2];
for (const [name, file] of Object.entries(groups)) {
	if (only && only !== name) continue;
	await (await import(file))[name]();
}

const failed = results.filter(result => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} steps passed`);
process.exit(failed.length ? 1 : 0);
