import type { Node } from '@beyond-js/packages/dependencies/graph';
import type { IGraphNode } from './types';
import type { IWorkspaceNode } from './workspace/types';
import { DependencySourceIsType } from '@beyond-js/packages/dependency-source';
import { Origin } from './origin';

const forms = ['source', 'distribution', 'npm'];

/**
 * The releases occurrences resolved to, keyed and described as the nodes of a graph document. A key names the
 * source of a release, so two sources of one name and version never share one:
 *
 * - `<registry id>:<name>@<version>` for a registry release (`npm:react@18.3.1`);
 * - `git:<host>/<owner>/<repo>@<commit>` for a git source, the repository at its pinned commit;
 * - `digest:<algorithm>-<hex>` for an archive URL, its content;
 * - `workspace:<id>` for a member of a workspace, the member itself, which no provider describes.
 */
export class Releases {
	#nodes: Map<string, IGraphNode | IWorkspaceNode> = new Map();
	#keys: Map<Node, string | null> = new Map();

	/**
	 * The described node of a key
	 */
	get(key: string): IGraphNode | IWorkspaceNode | undefined {
		return this.#nodes.get(key);
	}

	/**
	 * Every described node by key, in key order
	 */
	get sorted(): Record<string, IGraphNode | IWorkspaceNode> {
		const nodes: Record<string, IGraphNode | IWorkspaceNode> = {};
		[...this.#nodes.keys()].sort().forEach(key => (nodes[key] = this.#nodes.get(key)));
		return nodes;
	}

	/**
	 * The key of the release an occurrence resolved to, null when it failed. A peer requirement resolves to the
	 * release of the occurrence that provides it.
	 */
	key(node: Node): string | null {
		if (this.#keys.has(node)) return this.#keys.get(node);

		const target = node.soft ? node.provider : node;
		const owner = target?.link || target;
		const release = owner?.release;
		const failed =
			!owner || owner.error || target.error || !owner.version.resolved || !(release?.provider || release?.member);
		if (failed) {
			this.#keys.set(node, null);
			return null;
		}

		const { key, described } = this.#describe(owner);
		this.#keys.set(node, key);
		if (!this.#nodes.has(key)) this.#nodes.set(key, described);
		return key;
	}

	/**
	 * The visibility of a release, and how it was established when a credential was involved
	 */
	#visibility({ provider }: Node['release']): Pick<IGraphNode, 'visibility' | 'access'> {
		return provider.access
			? { visibility: provider.visibility, access: provider.access }
			: { visibility: provider.visibility };
	}

	#describe(owner: Node): { key: string; described: IGraphNode | IWorkspaceNode } {
		const { source, version, release } = owner;

		// A member is read from its directory: it has no provider, archive or integrity
		if (release.member) {
			const { id, name, version } = release.member;
			const origin = <const>{ provider: 'workspace' };
			const described: IWorkspaceNode = {
				name,
				version,
				origin,
				member: id,
				visibility: 'public',
				integrity: null,
				tarball: null
			};
			return { key: `workspace:${id}`, described };
		}

		const visibility = this.#visibility(release);
		const { data } = source;

		if (data.is === DependencySourceIsType.Url) {
			const [algorithm, value] = release.integrity.split('-');
			const digest = `${algorithm}-${Buffer.from(value, 'base64').toString('hex')}`;
			const base = { name: owner.package, version: version.resolved, origin: Origin.digest(release.provider) };
			const described = { ...base, ...visibility, integrity: release.integrity, tarball: this.#clean(data.url) };
			return { key: `digest:${digest}`, described };
		}

		const manifest = release.manifest;
		const form = (<any>manifest)?.beyond?.publication?.form;
		const publication = forms.includes(form) ? { publication: form } : {};

		if (data.is === DependencySourceIsType.Git) {
			// The repository and its commit are the identity; the name and the version are the ones its manifest
			// declares, which is how the runtime registers its modules
			const commit = version.resolved;
			const repository = `${data.baseurl}/${data.owner}/${data.repo}`;
			const declared =
				typeof manifest?.version === 'string' &&
				/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/.test(manifest.version);
			const described: IGraphNode = {
				name: manifest?.name || owner.package,
				version: declared ? manifest.version : '0.0.0',
				origin: Origin.git(repository, commit, data.base),
				...visibility,
				integrity: null,
				tarball: release.tarball,
				...publication
			};
			return { key: `git:${repository}@${commit}`, described };
		}

		const dist = manifest?.dist;
		const hex = typeof dist?.shasum === 'string' && /^[0-9a-f]{40}$/i.test(dist.shasum) ? dist.shasum : void 0;
		const integrity = dist?.integrity || (hex ? `sha1-${Buffer.from(hex, 'hex').toString('base64')}` : null);
		const origin = Origin.registry(release.provider);
		const base = { name: source.package, version: version.resolved, origin, ...visibility };
		const described = { ...base, integrity, tarball: this.#clean(dist?.tarball), ...publication };
		return { key: `${origin.provider}:${described.name}@${described.version}`, described };
	}

	/**
	 * An archive URL as it may be stored and shown: without user information
	 */
	#clean(url?: string): string | null {
		try {
			const parsed = new URL(url);
			parsed.username = '';
			parsed.password = '';
			return /^https?:$/.test(parsed.protocol) ? parsed.href : null;
		} catch {
			return null;
		}
	}
}
