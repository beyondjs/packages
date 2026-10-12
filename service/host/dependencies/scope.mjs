import { DependencyError } from './error.mjs';

/**
 * What a request of dependency management is about, as `?scope=` or a body's `scope` names it: `workspace` (every
 * node), `member:<id>` (a member and the nodes it reaches or that reach it) or `node:<key>` (a node of the graph and
 * the same closures). A member's id is its directory relative to the root (`.` for the root importer); a node's key
 * is the key of the lock or of the inventory (`npm:react@19.1.1`, `workspace:apps/web`, `supplied:…`, `declared:…`).
 *
 * ```js
 * const scope = Scope.parse('member:apps/web');   // {kind: 'member', id: 'apps/web'}
 * scope.text;                                     // 'member:apps/web'
 * ```
 */
export class Scope {
	static #MAX = 512;

	#kind;
	#value;

	/**
	 * @param {unknown} value The scope as text; absent or empty is the workspace
	 * @throws {DependencyError} `SCOPE_INVALID`
	 */
	static parse(value) {
		if (value === undefined || value === null || value === '' || value === 'workspace') return new Scope('workspace');
		if (typeof value === 'object' && !Array.isArray(value)) return Scope.#object(value);
		if (typeof value !== 'string' || value.length > Scope.#MAX) throw Scope.#invalid(value);
		const at = value.indexOf(':');
		const [kind, rest] = at < 0 ? [value, ''] : [value.slice(0, at), value.slice(at + 1)];
		if ((kind !== 'member' && kind !== 'node') || !rest || /[\u0000-\u001f]/.test(rest)) throw Scope.#invalid(value);
		return new Scope(kind, rest);
	}

	/**
	 * A scope given as the object a record carries: `{kind, id?, key?}`
	 */
	static #object({ kind, id, key }) {
		if (kind === 'workspace') return new Scope('workspace');
		if (kind === 'member' && typeof id === 'string') return Scope.parse(`member:${id}`);
		if (kind === 'node' && typeof key === 'string') return Scope.parse(`node:${key}`);
		throw Scope.#invalid(JSON.stringify({ kind, id, key }));
	}

	static #invalid(value) {
		const message = `The scope "${String(value).slice(0, 80)}" is not workspace, member:<id> or node:<key>`;
		return new DependencyError('SCOPE_INVALID', message);
	}

	constructor(kind, value) {
		this.#kind = kind;
		this.#value = value;
	}

	get kind() {
		return this.#kind;
	}

	/**
	 * The member id or the node key
	 */
	get value() {
		return this.#value;
	}

	get text() {
		return this.#kind === 'workspace' ? 'workspace' : `${this.#kind}:${this.#value}`;
	}

	toJSON() {
		if (this.#kind === 'workspace') return { kind: 'workspace' };
		return this.#kind === 'member' ? { kind: 'member', id: this.#value } : { kind: 'node', key: this.#value };
	}

	/**
	 * The key where the closures of this scope start, given the graph it reads
	 *
	 * @param {import('./graph.mjs').Graph} graph
	 * @returns {string | undefined} undefined for the workspace
	 * @throws {DependencyError} `SCOPE_NOT_FOUND` for a member or a node the graph does not have
	 */
	start(graph) {
		if (this.#kind === 'workspace') return;
		const key = this.#kind === 'member' ? graph.members[this.#value]?.node ?? `workspace:${this.#value}` : this.#value;
		if (graph.has(key)) return key;
		const what = this.#kind === 'member' ? `member "${this.#value}"` : `node "${this.#value}"`;
		throw new DependencyError('SCOPE_NOT_FOUND', `The workspace has no ${what}`, { scope: this.text });
	}
}
