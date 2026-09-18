/**
 * Generates `resources/watchers`: the source of the watchers service that this package distributes.
 *
 * The published `@beyond-js/watchers` contains its compiled client, which Packages imports, but not its
 * service. The service is compiled by the bootstrap from source, so the source travels with this package;
 * it cannot be a dependency, because it has the name and the version of the published package that the
 * same installation also needs. `BEYOND_WATCHERS_SOURCE` names the checkout to copy it from; inside the
 * suite it defaults to the sibling utility repository.
 */
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const source = resolve(process.env.BEYOND_WATCHERS_SOURCE || join(root, '../../utils/watchers'));
if (!existsSync(join(source, 'modules/service'))) {
	console.error(`No watchers source at "${source}". Set BEYOND_WATCHERS_SOURCE to a checkout of the watchers utility.`);
	process.exit(1);
}

const target = join(root, 'resources/watchers');
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
for (const entry of ['package.json', 'beyond.json', 'modules', 'fork', 'LICENSE']) {
	existsSync(join(source, entry)) && cpSync(join(source, entry), join(target, entry), { recursive: true });
}
console.log(`resources/watchers generated from ${source}`);
