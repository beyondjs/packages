import type { ILockDocument } from './types';
import { join } from 'path';
import { type IExecutionDocument, Execution } from '@beyond-js/packages/execution';

/**
 * Where the sources of every node of a lock are on this machine
 */
export interface IProjectionInput {
	lock: ILockDocument;
	// Root of the store the external nodes were fetched into
	store: string;
	// Node key → absolute directory of its package root, for every node of the lock
	locations: Map<string, string>;
}

/**
 * The execution projection of a workspace root (`.beyond/execution.json`, `beyond-execution/1`): the lock with
 * the location of every node and member. It is composed only once every node has a location and checked as an
 * `Execution` checks it; `Writer` puts it in place atomically, so a projection that exists is complete.
 */
export class Projection {
	#root: string;
	#path: string;
	get path() {
		return this.#path;
	}

	constructor(root: string) {
		this.#root = root;
		this.#path = join(root, ...Execution.PATH.split('/'));
	}

	/**
	 * @throws When a node or a member has no location, or the document is not a usable projection of the root
	 */
	compose({ lock, store, locations }: IProjectionInput): IExecutionDocument {
		const located = (key: string) => {
			const location = locations.get(key);
			if (!location) throw new Error(`The sources of "${key}" have no location`);
			return location;
		};

		const nodes: IExecutionDocument['nodes'] = {};
		for (const [key, node] of Object.entries(lock.nodes)) {
			nodes[key] = <IExecutionDocument['nodes'][string]>{ ...node, location: located(key) };
		}
		const members: IExecutionDocument['members'] = {};
		for (const [id, member] of Object.entries(lock.members)) {
			members[id] = { ...member, location: located(member.node) };
		}

		const document: IExecutionDocument = {
			protocol: 'beyond-execution/1',
			root: this.#root,
			lock: lock.digest,
			inputs: lock.inputs,
			store,
			members,
			nodes,
			edges: <IExecutionDocument['edges']>lock.edges,
			written: new Date().toISOString()
		};
		Execution.from(document, this.#root);
		return document;
	}
}
