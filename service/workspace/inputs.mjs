import { Canonical } from './canonical.mjs';

/**
 * The digests of what a workspace declares that its dependency graph depends on, so that a lock or an
 * execution projection can tell whether it was built from the current declaration:
 *
 * - `members[id]`: the canonical digest of `{name, version, dependencies, devDependencies,
 *   peerDependencies, peerDependenciesMeta, optionalDependencies}` of that member's manifest.
 * - `declaration`: the canonical digest of `{kind, members: [{id, name, version}] sorted by id, root}`,
 *   where `root` holds `{dependencies, devDependencies, peerDependencies, peerDependenciesMeta,
 *   optionalDependencies, overrides}` of the root manifest, for every kind: the graph reads them for the root
 *   importer, and the `overrides` of a standalone package or of a root that is a member are in no member's
 *   digest.
 *
 * Any other field (a description, the exports, the scripts) changes no digest, and neither does the order of
 * keys or of the declared patterns.
 */
export class Inputs {
	/**
	 * The fields of a member's manifest that its digest covers
	 */
	static MEMBER = Object.freeze([
		'name',
		'version',
		'dependencies',
		'devDependencies',
		'peerDependencies',
		'peerDependenciesMeta',
		'optionalDependencies'
	]);

	/**
	 * The fields of the root manifest that the declaration digest covers
	 */
	static ROOT = Object.freeze([
		'dependencies',
		'devDependencies',
		'peerDependencies',
		'peerDependenciesMeta',
		'optionalDependencies',
		'overrides'
	]);

	/**
	 * Computes the inputs of a declaration
	 *
	 * @param {object} declaration
	 * @param {string} declaration.kind
	 * @param {{id: string, name?: string, version?: string, manifest: object}[]} declaration.members
	 * @param {object} [declaration.manifest] The root manifest
	 * @returns {{declaration: string, members: Record<string, string>}} Frozen, with the members keyed by id in
	 * code unit order
	 */
	static compute({ kind, members, manifest }) {
		const sorted = [...members].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

		const document = {
			kind,
			members: sorted.map(({ id, name, version }) => ({ id, name, version })),
			root: Inputs.#pick(manifest ?? {}, Inputs.ROOT)
		};
		const digests = Object.fromEntries(
			sorted.map(({ id, manifest: member }) => [id, Canonical.digest(Inputs.#pick(member, Inputs.MEMBER))])
		);

		return Object.freeze({ declaration: Canonical.digest(document), members: Object.freeze(digests) });
	}

	static #pick(object, fields) {
		return Object.fromEntries(fields.map(field => [field, object[field]]));
	}
}
