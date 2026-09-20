import { createHash } from 'crypto';
import type { IKeyInputs } from './types';

const MEMBERS = ['module', 'sources', 'resolution', 'compiler', 'conditions', 'format', 'output'];

/**
 * The compatibility key of an output: sha256 over the canonical JSON of its inputs.
 *
 * Two outputs with the same key were produced from the same sources, resolved the same way, by the same
 * compiler with the same configuration, for the same conditions, format and kind, so one can stand for the
 * other. It is not the content digest, which identifies bytes. Where an output is stored and who may read
 * it (`public`, `org:<id>`) is never an input and always part of the lookup: inputs that carry a scope, or
 * any member the `beyond-inventory/1` contract does not define, are rejected instead of silently hashed or
 * silently ignored.
 */
export /*bundle*/ class Compatibility {
	/**
	 * JSON with the members of every object sorted by key and no insignificant whitespace; arrays keep their
	 * order, so a producer orders them before hashing
	 */
	static canonical(value: unknown): string {
		if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
		if (value instanceof Array) return `[${value.map(one => Compatibility.canonical(one)).join(',')}]`;

		const members = Object.keys(value).filter(name => (<Record<string, unknown>>value)[name] !== void 0).sort();
		return `{${members.map(name => `${JSON.stringify(name)}:${Compatibility.canonical((<Record<string, unknown>>value)[name])}`).join(',')}}`;
	}

	/**
	 * `sha256-<64 hexadecimal characters>` of the canonical JSON of a value
	 */
	static digest(value: unknown): string {
		return `sha256-${createHash('sha256').update(Compatibility.canonical(value)).digest('hex')}`;
	}

	/**
	 * @throws {TypeError} When the inputs carry a member that is not an input of the key, a storage scope
	 * above all, or lack one: a key computed from other inputs would never match the one of another producer
	 */
	static key(inputs: IKeyInputs): string {
		const members = Object.keys(inputs ?? {});
		const foreign = members.filter(member => !MEMBERS.includes(member));
		if (foreign.includes('scope')) throw new TypeError('The storage scope is part of the lookup, never an input of the compatibility key');
		if (foreign.length) throw new TypeError(`Not inputs of the compatibility key: ${foreign.join(', ')}`);

		const missing = MEMBERS.filter(member => !members.includes(member));
		if (missing.length) throw new TypeError(`Missing inputs of the compatibility key: ${missing.join(', ')}`);
		return Compatibility.digest(inputs);
	}
}
