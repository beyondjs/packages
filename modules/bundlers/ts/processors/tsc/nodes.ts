import type { Execution } from '@beyond-js/packages/execution';
import { realpathSync } from 'fs';
import { resolve, sep } from 'path';

/**
 * The nodes of an execution projection by the canonical paths of their locations.
 *
 * TypeScript names a file it reads through a slot by its real path, the projection records canonical
 * locations, and a package of the workspace may be given through a symbolic link: every path is compared in
 * its canonical form, so a file or a directory reached through a link belongs to the node it links to.
 */
export class Nodes {
	// The canonical locations of the nodes of each projection with their keys, the deepest first
	static #indexes: WeakMap<Execution, [string, string][]> = new WeakMap();

	#locations: [string, string][];
	#paths: Map<string, string> = new Map();

	constructor(execution: Execution) {
		if (!Nodes.#indexes.has(execution)) {
			const locations = [...execution.nodes.values()].map((node): [string, string] => [Nodes.real(node.location), node.key]);
			Nodes.#indexes.set(execution, locations.sort((a, b) => b[0].length - a[0].length));
		}
		this.#locations = Nodes.#indexes.get(execution);
	}

	/**
	 * The canonical path of a file or a directory in POSIX form: its real path, or its resolved path when it
	 * does not exist
	 */
	static real(path: string): string {
		let real: string;
		try {
			real = realpathSync(path);
		} catch {
			real = resolve(path);
		}
		return real.split(sep).join('/');
	}

	#real(path: string): string {
		!this.#paths.has(path) && this.#paths.set(path, Nodes.real(path));
		return this.#paths.get(path);
	}

	/**
	 * The key of the node whose location is a directory
	 */
	at(path: string): string | undefined {
		const real = this.#real(path);
		return this.#locations.find(([location]) => location === real)?.[1];
	}

	/**
	 * The key of the node whose location holds a file: the deepest one
	 */
	containing(file: string): string | undefined {
		const real = this.#real(file);
		return this.#locations.find(([location]) => real === location || real.startsWith(`${location}/`))?.[1];
	}
}
