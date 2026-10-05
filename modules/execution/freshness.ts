import type { IExecutionDocument, IExecutionInputs } from './types';
import { promises as fs } from 'fs';
import { join } from 'path';
import { Digest } from './digest';

const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * What changed since a projection was written: the inputs of the workspace (its declaration and each member
 * manifest) and the lock it was built from.
 */
export class Freshness {
	/**
	 * The name of the lock file at a workspace root: the one constant every reader and writer of the lock uses
	 */
	static LOCK = 'beyond-lock.json';

	/**
	 * @param inputs The current inputs of the workspace; without them only the lock is compared
	 * @returns What differs, in order (`declaration`, `member:<id>` by id, `lock`), each with how a person reads it
	 */
	static async changes(document: IExecutionDocument, root: string, inputs?: object): Promise<Map<string, string>> {
		const changes: Map<string, string> = new Map();
		const recorded = document.inputs || {};
		const current = <IExecutionInputs>inputs;

		if (current) {
			if (Freshness.#declaration(recorded, current)) changes.set('declaration', 'the workspace declaration');
			const members = Freshness.#manifests(recorded, current);
			members.forEach(id => changes.set(`member:${id}`, `the manifest of the member ${id}`));
		}
		if ((await Freshness.#lock(root)) !== document.lock) changes.set('lock', Freshness.LOCK);
		return changes;
	}

	/**
	 * Whether the declaration differs: its digest, or any other input than the members' digests
	 */
	static #declaration(recorded: IExecutionInputs, current: IExecutionInputs): boolean {
		const { declaration, members, ...rest } = recorded;
		const others = Digest.text(rest) !== Digest.text({ ...current, declaration: void 0, members: void 0 });
		return declaration !== current.declaration || others;
	}

	/**
	 * The members whose manifest digest differs, or that are on one side only, by id
	 */
	static #manifests(recorded: IExecutionInputs, current: IExecutionInputs): string[] {
		const before = recorded.members || {};
		const now = current.members || {};
		const ids = new Set([...Object.keys(before), ...Object.keys(now)]);
		return [...ids].filter(id => before[id] !== now[id]).sort(order);
	}

	/**
	 * The digest of the lock at the root, computed from its content: a lock edited without updating its own
	 * digest is a change as well. Undefined when there is no lock or it cannot be read.
	 */
	static async #lock(root: string): Promise<string | undefined> {
		try {
			const data = JSON.parse(await fs.readFile(join(root, Freshness.LOCK), 'utf8'));
			if (!data || typeof data !== 'object' || Array.isArray(data)) return;
			const { digest, ...content } = data;
			return Digest.of(content);
		} catch {
			return;
		}
	}
}
