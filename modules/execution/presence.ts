import type { IExecutionDocument } from './types';
import { promises as fs } from 'fs';

// Directories checked at once: a large graph is checked in slices instead of opening every handle together
const SLICE = 64;

/**
 * Whether the sources of each node are still where the projection says: a member directory that was removed,
 * or a source deleted from the store, leaves the projection incomplete.
 */
export class Presence {
	/**
	 * @returns The keys of the nodes whose location is not a directory, sorted
	 */
	static async missing(nodes: IExecutionDocument['nodes']): Promise<string[]> {
		const entries = Object.entries(nodes).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
		const missing: string[] = [];

		for (let at = 0; at < entries.length; at += SLICE) {
			const slice = entries.slice(at, at + SLICE);
			const found = await Promise.all(slice.map(([, { location }]) => Presence.#directory(location)));
			slice.forEach(([key], index) => found[index] || missing.push(key));
		}
		return missing;
	}

	static async #directory(location: string): Promise<boolean> {
		try {
			return (await fs.stat(location)).isDirectory();
		} catch {
			return false;
		}
	}
}
