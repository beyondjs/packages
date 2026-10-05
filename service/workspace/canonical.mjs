import { createHash } from 'node:crypto';

/**
 * Canonical JSON and its digest. Object keys are sorted recursively by code unit, there is no whitespace
 * and members whose value is undefined are omitted, so two documents that differ only in the order of
 * their keys have one canonical form and one digest. Arrays keep their order.
 */
export class Canonical {
	/**
	 * The canonical JSON text of a JSON value
	 *
	 * @param {unknown} value A JSON value: null, a boolean, a number, a string, an array or a plain object
	 * @returns {string}
	 */
	static stringify(value) {
		if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
		if (Array.isArray(value)) return `[${value.map(item => Canonical.stringify(item)).join(',')}]`;

		const keys = Object.keys(value)
			.filter(key => value[key] !== undefined)
			.sort();
		return `{${keys.map(key => `${JSON.stringify(key)}:${Canonical.stringify(value[key])}`).join(',')}}`;
	}

	/**
	 * The digest of the canonical JSON text of a value: `sha256-` followed by the hexadecimal digest
	 *
	 * @param {unknown} value
	 * @returns {string}
	 */
	static digest(value) {
		return `sha256-${createHash('sha256').update(Canonical.stringify(value)).digest('hex')}`;
	}
}
