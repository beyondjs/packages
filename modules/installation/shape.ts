import { LockDocument } from './document';

const object = (value: any) => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: any) => typeof value === 'string' && !!value;

/**
 * Whether a parsed `beyond-lock/2` document can be the graph of an installation: it has the members a lock has, the
 * structural rules of the execution projection hold (each member names its own `workspace:` node; edges and peer
 * contexts name nodes the lock holds; an edge without a target names what it skipped), and the digest it records is
 * the digest of its content. A lock edited by hand, merged or written by another version fails the last rule, and is
 * then resolved again with its selections as preferences instead of trusted.
 */
export class LockShape {
	/**
	 * @returns Why the document cannot be the graph, or undefined when it can
	 */
	static check(data: any): string | undefined {
		if (!object(data.inputs) || !object(data.members) || !object(data.nodes)) {
			return 'its inputs, members or nodes are missing';
		}
		if (!Array.isArray(data.edges) || !Array.isArray(data.overrides) || !Array.isArray(data.exceptions)) {
			return 'its edges, overrides or exceptions are missing';
		}
		const digest = data.digest === LockDocument.digest(data) ? void 0 : 'the digest it records is not its own';
		return LockShape.#nodes(data.nodes) ?? LockShape.#members(data) ?? LockShape.#edges(data) ?? digest;
	}

	static #nodes(nodes: Record<string, any>): string | undefined {
		for (const [key, node] of Object.entries(nodes)) {
			if (!object(node) || !text(node.name) || !text(node.version)) return `the node "${key}" is invalid`;
			if (!object(node.origin) || !text(node.origin.provider)) return `the node "${key}" has no origin`;
			const member = node.origin.provider === 'workspace';
			if (member !== key.startsWith('workspace:')) return `the node "${key}" has the origin of another kind`;
		}
		return;
	}

	static #members({ members, nodes }: any): string | undefined {
		for (const [id, member] of Object.entries<any>(members)) {
			if (!object(member) || !text(member.name) || !text(member.version)) return `the member "${id}" is invalid`;
			if (member.node !== `workspace:${id}` || !nodes[member.node]) {
				return `the member "${id}" does not name its own node workspace:${id}`;
			}
		}
		return;
	}

	static #edges({ edges, nodes, exceptions }: any): string | undefined {
		const known = (key: any) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(nodes, key);
		for (const edge of edges) {
			if (!object(edge) || !known(edge.from) || (edge.to !== null && !known(edge.to))) {
				return 'an edge names a node the lock does not have';
			}
			const wrong =
				(edge.name !== void 0 && !text(edge.name) && 'an invalid name') ||
				(edge.to === null && !text(edge.name) && 'neither a target nor a name') ||
				(edge.context !== void 0 && !known(edge.context) && 'a context that names no node') ||
				((!text(edge.kind) || typeof edge.range !== 'string') && 'no kind or range');
			if (wrong) return `an edge of "${edge.from}" has ${wrong}`;
		}
		if (exceptions.some((exception: any) => !object(exception) || !text(exception.node))) {
			return 'an exception names no node';
		}
		return;
	}
}
