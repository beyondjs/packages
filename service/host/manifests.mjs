import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SKIPPED = new Set(['node_modules', '.git', '.beyond', '.artifacts']);
const NAMES = new Set(['beyond.json', 'package.json', 'module.json']);

/**
 * The declaration files of a workspace, and whether they changed since they were last looked at.
 *
 * Packages watches the sources of its processors, not the manifests that declare packages and modules, so a
 * workspace object keeps the declarations it read when it was created. The service compares the manifests
 * when it is asked to resolve or describe the workspace, and reloads the workspace when they differ; nothing
 * is watched, so nothing can be missed. Only names, sizes and modification times are read: which packages
 * and modules the manifests declare is decided by Packages.
 */
export class Manifests {
	#root;
	#signature;

	/**
	 * @param {string} root The workspace directory
	 */
	constructor(root) {
		this.#root = root;
		this.#signature = this.#read();
	}

	#read() {
		const found = [];
		const visit = directory => {
			let entries;
			try {
				entries = readdirSync(directory, { withFileTypes: true });
			} catch {
				return;
			}

			for (const entry of entries) {
				if (entry.isDirectory()) {
					!SKIPPED.has(entry.name) && !entry.name.startsWith('.') && visit(join(directory, entry.name));
				} else if (NAMES.has(entry.name)) {
					const file = join(directory, entry.name);
					const { mtimeMs, size } = statSync(file, { throwIfNoEntry: false }) ?? {};
					found.push(`${file}:${mtimeMs}:${size}`);
				}
			}
		};

		visit(this.#root);
		return found.sort().join('\n');
	}

	/**
	 * Whether a manifest was added, removed or modified since the last call. The new state becomes the
	 * reference, so one change is reported once.
	 */
	get changed() {
		const current = this.#read();
		if (current === this.#signature) return false;

		this.#signature = current;
		return true;
	}
}
