import type { IWorkspaceMember, IWorkspaceMembers } from '@beyond-js/packages/project/types';
import type { IPackageManifest } from '@beyond-js/packages/types';
import type { IGraphDiagnostic } from '../types';
import { WorkspaceInfo } from '@beyond-js/packages/dependency-source';
import { valid, rcompare } from 'semver';

// The groups that make the root package an importer of its own
const groups = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The members of a workspace as its graph consults them: which names the workspace owns, the instances of each
 * name, and the importers. The root package is an importer (`.`) only when no member is the root and it
 * declares dependencies of its own; it never owns its name unless it is a member. A member whose manifest
 * cannot be used still owns its name, so its dependents never reach a registry for it, but it is no instance.
 */
export class WorkspaceMembers implements IWorkspaceMembers {
	#ids: Set<string> = new Set();
	#members: Map<string, IWorkspaceMember> = new Map();
	#names: Map<string, IWorkspaceMember[]> = new Map();
	#owned: Set<string> = new Set();
	#root?: IWorkspaceMember;

	#diagnostics: IGraphDiagnostic[] = [];
	/**
	 * Members that cannot take part in the graph
	 */
	get diagnostics() {
		return this.#diagnostics;
	}

	/**
	 * @param members The members the declaration of the workspace found
	 * @param root The root package of the workspace
	 */
	constructor(members: IWorkspaceMember[], root: { name?: string; manifest?: IPackageManifest } = {}) {
		if (!Array.isArray(members)) throw new Error('The members of the workspace are required');
		members.forEach(member => this.#add(member));
		this.#names.forEach(instances => instances.sort((a, b) => rcompare(a.version, b.version) || order(a.id, b.id)));

		const manifest = root?.manifest;

		if (this.#members.has('.') || !WorkspaceMembers.#declares(manifest)) return;

		const version = typeof manifest.version === 'string' && valid(manifest.version) ? manifest.version : '0.0.0';
		const name = root.name || (typeof manifest.name === 'string' && manifest.name) || '.';
		this.#root = { id: '.', name, version, manifest };
	}

	/**
	 * Whether the manifest declares a dependency in any group
	 */
	static #declares(manifest?: IPackageManifest): boolean {
		if (!manifest || typeof manifest !== 'object') return false;
		return groups.some(group => {
			const declared = <unknown>manifest[group];
			return !!declared && typeof declared === 'object' && Object.keys(declared).length > 0;
		});
	}

	#add(member: IWorkspaceMember) {
		const { id, name, version, manifest } = member || <IWorkspaceMember>{};
		// An id is what `workspace:<id>` names: the canonical relative POSIX path of the member's directory
		if (typeof id !== 'string' || WorkspaceInfo.parse(`workspace:./${id}`)?.member !== id) {
			throw new Error(`The id of a member is the canonical relative path of its directory, not "${id}"`);
		}
		if (this.#ids.has(id)) throw new Error(`The member "${id}" of the workspace is given more than once`);
		this.#ids.add(id);

		const named = typeof name === 'string' && !!name;
		if (named) this.#owned.add(name);
		if (!named || typeof version !== 'string' || !valid(version) || !manifest || typeof manifest !== 'object') {
			const message = `The member "${id}" requires a name, a valid semver version and its manifest`;
			this.#diagnostics.push({ code: 'MEMBER_MANIFEST_INVALID', message, severity: 'error' });
			return;
		}

		this.#members.set(id, member);
		if (!this.#names.has(name)) this.#names.set(name, []);
		this.#names.get(name).push(member);
	}

	/**
	 * Whether a member provides the name, valid or not
	 */
	owns(name: string): boolean {
		return this.#owned.has(name);
	}

	/**
	 * The valid members of a name, highest version first, then by id
	 */
	instances(name: string): IWorkspaceMember[] {
		return [...(this.#names.get(name) || [])];
	}

	/**
	 * A valid member by id, or the root package (`.`) when it is an importer without being a member
	 */
	member(id: string): IWorkspaceMember | undefined {
		return this.#members.get(id) || (id === '.' ? this.#root : void 0);
	}

	/**
	 * The valid members by id, then the root package when it is an importer of its own
	 */
	get importers(): IWorkspaceMember[] {
		const members = [...this.#members.values()].sort((a, b) => order(a.id, b.id));
		return this.#root ? [...members, this.#root] : members;
	}
}
