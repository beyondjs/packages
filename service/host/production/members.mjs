import { Declaration } from '../../workspace/declaration.mjs';
import { ExportError } from '../exports/error.mjs';
import { Roots } from '../exports/roots.mjs';
import { ProductionError } from './error.mjs';

/**
 * The package a production route works on, named in its address (`/production/packages/:member`) by the member's id,
 * its directory relative to the root (`packages/ui`, `.` for the root package, encoded as `packages%2Fui`), or by its
 * package name (`@scope/ui`) when one member has it.
 *
 * The package is the one a source export of the same directory would freeze ([Roots](../exports/roots.mjs)): a member
 * the workspace declares inside its root, reached without a symbolic link, with a manifest that names it and its
 * version, and the directories of the other members inside it, which its archive leaves out. The declaration is read
 * at every request, so a member declared since the service started is found.
 *
 * ```js
 * const member = new Members(root).resolve('packages%2Fui');
 * // {id, directory, manifest, members}
 * ```
 */
export class Members {
	#root;

	/**
	 * @param {string} root The canonical root of the workspace
	 */
	constructor(root) {
		this.#root = root;
	}

	/**
	 * The members of the workspace as its declaration lists them: `{id, name, version, path, manifest}`
	 */
	get declared() {
		return Declaration.read(this.#root).members;
	}

	/**
	 * @param {string} reference A member id or a package name, as the route received it (decoded)
	 * @returns {{id: string, directory: string, manifest: object, members: string[]}}
	 * @throws {ProductionError} `MEMBER_NOT_FOUND`, `MEMBER_AMBIGUOUS` or `MEMBER_INVALID`
	 */
	resolve(reference) {
		if (typeof reference !== 'string' || !reference || reference.length > 512) {
			throw new ProductionError('MEMBER_NOT_FOUND', 'A package is named by its directory in the workspace or by its name');
		}
		const members = this.declared;
		const found = members.find(({ id }) => id === reference);
		const named = found ? [found] : members.filter(({ name }) => name === reference);
		if (!named.length) throw new ProductionError('MEMBER_NOT_FOUND', `No member of the workspace has the directory or the name "${reference}"`);
		if (named.length > 1) {
			const ids = named.map(({ id }) => id);
			throw new ProductionError('MEMBER_AMBIGUOUS', `Several members are named "${reference}" (${ids.join(', ')}): name one by its directory`, { members: ids });
		}

		const [{ id }] = named;
		try {
			const [resolved] = new Roots(this.#root).resolve([id]);
			return { id, directory: resolved.directory, manifest: resolved.manifest, members: resolved.members };
		} catch (error) {
			if (error instanceof ExportError) throw new ProductionError('MEMBER_INVALID', error.message);
			throw error;
		}
	}
}
