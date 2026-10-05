/**
 * Canonical JSON, written here independently of the implementation so that a test can recompute what a document
 * says of itself: object keys sorted, no insignificant whitespace, undefined members omitted.
 */
import { createHash } from 'node:crypto';

export class Canonical {
	/**
	 * The canonical text of a value
	 */
	static text(value) {
		if (value === null || typeof value !== 'object') return JSON.stringify(value === undefined ? null : value);
		if (Array.isArray(value)) return `[${value.map(item => Canonical.text(item)).join(',')}]`;
		const members = Object.keys(value)
			.filter(key => value[key] !== undefined)
			.sort()
			.map(key => `${JSON.stringify(key)}:${Canonical.text(value[key])}`);
		return `{${members.join(',')}}`;
	}

	/**
	 * `sha256-<hex>` of the canonical text
	 */
	static digest(value) {
		return `sha256-${createHash('sha256').update(Canonical.text(value)).digest('hex')}`;
	}

	/**
	 * The value with its object keys sorted at every level, arrays kept in their order
	 */
	static sorted(value) {
		if (value === null || typeof value !== 'object') return value;
		if (Array.isArray(value)) return value.map(item => Canonical.sorted(item));
		const sorted = {};
		for (const key of Object.keys(value).sort()) if (value[key] !== undefined) sorted[key] = Canonical.sorted(value[key]);
		return sorted;
	}

	/**
	 * How a lock is written: canonical key order, two-space indentation and a final newline
	 */
	static pretty(value) {
		return `${JSON.stringify(Canonical.sorted(value), null, 2)}\n`;
	}
}
