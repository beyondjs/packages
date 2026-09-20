import type { IDiagnostic } from '@beyond-js/packages/types';
import { Media } from '@beyond-js/packages/publication';
import { promises as fs } from 'fs';
import { join, posix } from 'path';
import type { IItem } from './types';
import type { Opened } from './pinned/opened';
import { Keyed } from './keyed';

/**
 * The static files of an inventory: the ones a module or a package declares, and the ones a stylesheet or a
 * source references. A file is one item however many modules use it, identified by its path inside its
 * package, which is the path of its `/assets/` address. A static file is the same for every condition.
 */
export /*bundle*/ class Assets {
	#items: Map<string, IItem> = new Map();
	get items(): IItem[] {
		return [...this.#items.values()];
	}

	#diagnostics: IDiagnostic[] = [];
	get diagnostics() {
		return this.#diagnostics;
	}

	/**
	 * @param path The path inside the package
	 * @param declared Whether a manifest declares the file, or only a reference uses it
	 * @returns The id of the item, or undefined when the file cannot be inventoried
	 */
	async add(opened: Opened, path: string, declared: boolean): Promise<string | undefined> {
		const normalized = posix.normalize(path);
		if (normalized.startsWith('..') || posix.isAbsolute(normalized)) {
			this.#diagnostics.push({ code: 'ASSET_OUTSIDE_PACKAGE', message: `Asset "${path}" of "${opened.key}" is outside the package` });
			return;
		}

		const id = Keyed.id('asset', opened.key, normalized);
		const known = this.#items.get(id);
		if (known) {
			if (declared) known.declared = true;
			return id;
		}

		// A distribution lists its files; any other form is read from its sources
		const exists = (await opened.listed(normalized)) ?? (await fs.stat(join(opened.root, normalized)).then(stat => stat.isFile(), () => false));
		if (!exists) {
			this.#diagnostics.push({ code: 'ASSET_NOT_FOUND', message: `Asset "${normalized}" does not exist in package "${opened.key}"` });
			return;
		}

		const item = Keyed.asset(opened, normalized, Media.of(normalized));
		if (!item) return;
		if (declared) item.declared = true;
		this.#items.set(id, item);
		return id;
	}
}
