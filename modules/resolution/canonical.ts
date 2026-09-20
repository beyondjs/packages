import { createHash } from 'crypto';

/**
 * Canonical JSON: object keys sorted, no insignificant whitespace, undefined members omitted. Two values
 * that are equal as data have the same text and therefore the same digest.
 */
export /*bundle*/ class Canonical {
	static text(value: any): string {
		if (value === null || typeof value !== 'object') return JSON.stringify(value === void 0 ? null : value);
		if (Array.isArray(value)) return `[${value.map(item => Canonical.text(item)).join(',')}]`;

		const members = Object.keys(value)
			.filter(key => value[key] !== void 0)
			.sort()
			.map(key => `${JSON.stringify(key)}:${Canonical.text(value[key])}`);
		return `{${members.join(',')}}`;
	}

	static digest(value: any): string {
		return `sha256-${createHash('sha256').update(Canonical.text(value)).digest('hex')}`;
	}
}
