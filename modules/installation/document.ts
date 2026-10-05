import type { IInstalledGraph, ILockDocument } from './types';
import { Canonical } from '@beyond-js/packages/resolution';

// The members each part of the lock may have: whatever else a graph carries never reaches a committed file
const FIELDS = {
	member: ['name', 'version', 'node'],
	node: ['name', 'version', 'origin', 'visibility', 'access', 'integrity', 'tarball', 'publication', 'member'],
	origin: ['provider', 'registry'],
	edge: ['from', 'to', 'name', 'kind', 'range', 'context', 'override', 'skipped'],
	override: ['name', 'selection', 'within'],
	exception: ['node', 'kind', 'provider', 'reason']
};

const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Composes the `beyond-lock/2` document of a graph: the members, nodes, edges, overrides and exceptions it
 * pinned and the inputs it was resolved from, with the digest of all of them. Only the members the protocol
 * names are kept, arrays are sorted by their canonical text and keys are written in canonical order, so equal
 * graphs give byte-equal locks.
 *
 * A lock is the same for everyone who resolves the workspace: `access` is recorded on private nodes only. A
 * public release read with a credential is probed anonymously and found public (`access: 'anonymous'`), which
 * would make the lock of a person with a registry login differ from the lock of one without.
 */
export class LockDocument {
	static compose(graph: IInstalledGraph, inputs: object): ILockDocument {
		const pick = (value: any, fields: string[]) => {
			const picked: Record<string, any> = {};
			fields.forEach(field => value?.[field] !== void 0 && (picked[field] = value[field]));
			return picked;
		};
		const list = (items: any[], fields: string[]) =>
			(items || [])
				.map(item => pick(item, fields))
				.map(item => ({ item, text: Canonical.text(item) }))
				.sort((a, b) => order(a.text, b.text))
				.map(({ item }) => item);

		const members: ILockDocument['members'] = {};
		for (const id of Object.keys(graph.members || {}).sort(order)) {
			members[id] = <ILockDocument['members'][string]>pick(graph.members[id], FIELDS.member);
		}
		const nodes: ILockDocument['nodes'] = {};
		for (const key of Object.keys(graph.nodes || {}).sort(order)) {
			const node = pick(graph.nodes[key], FIELDS.node);
			node.origin && (node.origin = pick(node.origin, FIELDS.origin));
			if (node.visibility !== 'private') delete node.access;
			nodes[key] = node;
		}

		const content = {
			protocol: <const>'beyond-lock/2',
			inputs: JSON.parse(JSON.stringify(inputs ?? {})),
			members,
			nodes,
			edges: list(graph.edges, FIELDS.edge),
			overrides: list(graph.overrides, FIELDS.override),
			exceptions: list(graph.exceptions, FIELDS.exception)
		};
		return { ...content, digest: LockDocument.digest(content) };
	}

	/**
	 * The digest of a lock: `sha256-` of the canonical JSON of every member but `digest`
	 */
	static digest(document: object): string {
		const { digest, ...content } = <any>document;
		return Canonical.digest(content);
	}

	/**
	 * The text of a document as it is written: keys in canonical order, two spaces, a final newline
	 */
	static text(document: object): string {
		const sorted = (value: any): any => {
			if (!value || typeof value !== 'object') return value;
			if (Array.isArray(value)) return value.map(sorted);
			const copy: Record<string, any> = {};
			Object.keys(value)
				.sort(order)
				.forEach(key => value[key] !== void 0 && (copy[key] = sorted(value[key])));
			return copy;
		};
		return `${JSON.stringify(sorted(document), null, 2)}\n`;
	}
}
