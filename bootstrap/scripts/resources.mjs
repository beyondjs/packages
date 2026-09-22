/**
 * Generates `resources/`: the sources of the Beyond-authored packages that this package distributes.
 *
 * Two reasons put them here rather than in a dependency:
 *
 * - The published `@beyond-js/watchers` contains the compiled client that Packages imports but not its
 *   service, which the bootstrap compiles from source.
 * - The published utilities are the ones an installation resolves, and a repair in them reaches nothing that
 *   runs until a new version exists. Carrying their sources lets the bootstrap serve them instead, which is
 *   what `BEYOND_LOCAL_PACKAGES` selects.
 *
 * None of them can be a dependency: each has the name and the version of the published package that the same
 * installation also needs. Their own dependencies are dependencies of this package, or of `@beyond-js/packages`,
 * for that reason.
 *
 * `BEYOND_UTILITIES` names the directory the checkouts are copied from; inside the suite it defaults to the
 * sibling utility repositories. `BEYOND_WATCHERS_SOURCE` still names the watchers checkout on its own.
 */
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const utilities = resolve(process.env.BEYOND_UTILITIES || join(root, '../../utils'));

// Each carried package: where its checkout is, and the file that proves the copy is the right one
const carried = [
	{ resource: 'watchers', source: process.env.BEYOND_WATCHERS_SOURCE || join(utilities, 'watchers'), proof: 'modules/service' },
	{ resource: 'dynamic-processor', source: join(utilities, 'dynamic-processor'), proof: 'src/modules/main' },
	{ resource: 'finder', source: join(utilities, 'finder'), proof: 'modules/main' }
];

// What of a checkout is copied: the manifests, the sources and the licence, never its installed packages
const entries = ['package.json', 'beyond.json', 'modules', 'src', 'fork', 'LICENSE'];

for (const { resource, source, proof } of carried) {
	const path = resolve(source);
	if (!existsSync(join(path, proof))) {
		console.error(`No ${resource} source at "${path}". Set BEYOND_UTILITIES to the utility checkouts.`);
		process.exit(1);
	}

	const target = join(root, 'resources', resource);
	rmSync(target, { recursive: true, force: true });
	mkdirSync(target, { recursive: true });
	for (const entry of entries) {
		existsSync(join(path, entry)) && cpSync(join(path, entry), join(target, entry), { recursive: true });
	}
	console.log(`resources/${resource} generated from ${path}`);
}
