import type { IInstallationDiagnostic, IInstallationMember, IInstalledGraph } from './types';
import { promises as fs } from 'fs';

// Directories made canonical at once: a large graph is handled in slices instead of opening every handle together
const SLICE = 64;

/**
 * Where the sources of every node of a graph are on this machine: the directory of each member (the root itself
 * for the root importer) and the store's directory of each fetched source, each recorded as its real path. A
 * directory reached through a symbolic link (a store under `/tmp` on macOS, a member opened through a link) is
 * recorded where it really is, because that is the path consumers compare.
 */
export class Locations {
	#root: string;
	#members: Map<string, string> = new Map();

	#map: Map<string, string> = new Map();
	/**
	 * Node key → canonical directory of its package root, once `run` answered true
	 */
	get map(): Map<string, string> {
		return new Map(this.#map);
	}

	#diagnostics: IInstallationDiagnostic[] = [];
	/**
	 * Why a node has no location: `MEMBER_NOT_FOUND` for a member, `SOURCE_MISSING` for a fetched source
	 */
	get diagnostics(): IInstallationDiagnostic[] {
		return [...this.#diagnostics];
	}

	/**
	 * @param root The canonical workspace root
	 * @param members The members as the declaration reads them
	 */
	constructor(root: string, members: IInstallationMember[]) {
		this.#root = root;
		for (const { id, path } of members) typeof path === 'string' && path && this.#members.set(id, path);
	}

	/**
	 * Locates every node of the graph
	 *
	 * @param fetched The store's directory of every external node, by key
	 * @returns Whether every node has a canonical location
	 */
	async run(graph: IInstalledGraph, fetched: Map<string, string>): Promise<boolean> {
		const wanted: { key: string; path: string; member?: string }[] = [];
		for (const [id, { node }] of Object.entries(graph.members)) {
			const path = this.#members.get(id) ?? (id === '.' ? this.#root : void 0);
			if (path) {
				wanted.push({ key: node, path, member: id });
				continue;
			}
			const message = `The graph names the member "${id}", which the workspace does not declare`;
			this.#diagnostics.push({ code: 'MEMBER_NOT_FOUND', message, severity: 'error', node });
		}
		fetched.forEach((path, key) => wanted.push({ key, path }));

		for (let at = 0; at < wanted.length; at += SLICE) {
			await Promise.all(wanted.slice(at, at + SLICE).map(item => this.#locate(item)));
		}
		this.#diagnostics.sort((a, b) => (a.node < b.node ? -1 : a.node > b.node ? 1 : 0));
		return !this.#diagnostics.length;
	}

	async #locate({ key, path, member }: { key: string; path: string; member?: string }): Promise<void> {
		try {
			this.#map.set(key, await fs.realpath(path));
		} catch (error) {
			const where = `${path} (${error?.code || 'unknown error'})`;
			if (member === void 0) {
				const message = `The sources of ${key} are not at ${where}`;
				this.#diagnostics.push({ code: 'SOURCE_MISSING', message, severity: 'error', node: key });
			} else {
				const message = `The directory of the member ${member} is not at ${where}`;
				this.#diagnostics.push({ code: 'MEMBER_NOT_FOUND', message, severity: 'error', node: key });
			}
		}
	}
}
