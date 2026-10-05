import type { IExecutionDocument, IExecutionNode } from './types';
import { isAbsolute, relative, resolve, sep } from 'path';

/**
 * Why a projection read from disk cannot be used because of where it locates its nodes
 */
export interface IMisplaced {
	message: string;
	details?: Record<string, any>;
}

/**
 * Where a projection read from disk may locate its nodes. A projection is machine-local and never committed, but a
 * file found in a checkout is not trusted with the directories it names:
 *
 * - an external node must be a source of the projection's store, at the directory the store keeps for it:
 *   `<store>/<scope>/<origin>/<name>/<version>/<integrity>/files`, with the scope `public` for a public node and
 *   `org/<tenant>` otherwise, and `established` as the integrity of a source that published none;
 * - a member's node must be at the member's directory, and that directory must be the one the workspace declares
 *   now, when the reader is told (`current.locations`).
 *
 * Anything else makes the projection incompatible: it is never served.
 */
export class Placement {
	/**
	 * @param locations The canonical directory of each member, by id, as the workspace declares it now
	 * @returns Why the projection cannot be used, or undefined when every node is where it may be
	 */
	static check(document: IExecutionDocument, locations?: Record<string, string>): IMisplaced | undefined {
		return Placement.#members(document, locations) ?? Placement.#sources(document);
	}

	static #members(document: IExecutionDocument, locations?: Record<string, string>): IMisplaced | undefined {
		const moved: string[] = [];
		for (const [id, member] of Object.entries(document.members)) {
			const location = resolve(member.location);
			if (resolve(document.nodes[member.node].location) !== location) {
				return { message: `The execution projection locates the member ${id} and its node apart` };
			}

			const declared = locations && Object.prototype.hasOwnProperty.call(locations, id) ? locations[id] : void 0;
			if (typeof declared === 'string' && declared && resolve(declared) !== location) moved.push(id);
		}
		if (!moved.length) return;

		const where = moved.map(id => `${id} at ${document.members[id].location}, declared at ${locations[id]}`);
		const message = `The execution projection locates the member ${where.join('; ')}`;
		return { message, details: { changed: moved.map(id => `member:${id}`) } };
	}

	static #sources(document: IExecutionDocument): IMisplaced | undefined {
		const store = resolve(document.store);
		for (const [key, node] of Object.entries(document.nodes)) {
			if (key.startsWith('workspace:') || Placement.#stored(store, { ...node, key })) continue;
			return { message: `The execution projection locates ${key} outside its store (${node.location})` };
		}
		return;
	}

	/**
	 * Whether a node is at the directory its store keeps for it
	 */
	static #stored(store: string, node: IExecutionNode): boolean {
		const path = relative(store, resolve(node.location));
		if (!path || path.startsWith('..') || isAbsolute(path)) return false;

		const segments = path.split(sep);
		const scoped = node.visibility === 'public' ? segments[0] === 'public' : segments[0] === 'org' && !!segments[1];
		if (!scoped) return false;

		const [origin, name, version, integrity, files, ...rest] = segments.slice(node.visibility === 'public' ? 1 : 2);
		const found = [origin, name, version, files];
		const encode = (value: any) => encodeURIComponent(String(value));
		const expected = [encode(node.origin?.provider), encode(node.name), encode(node.version)];
		if (rest.length || [...expected, 'files'].some((segment, index) => segment !== found[index])) return false;
		const published = typeof node.integrity === 'string' && !!node.integrity;
		return published ? !!integrity && integrity !== 'established' : integrity === 'established';
	}
}
