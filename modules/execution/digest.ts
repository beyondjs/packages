import { createHash } from 'crypto';

/**
 * The digest of a document as the lock records it: `sha256-` of its canonical JSON (object keys sorted, no
 * insignificant whitespace, undefined members omitted). It gives the same text as `Canonical` of
 * `@beyond-js/packages/resolution`, which writes the lock; the projection reader keeps its own copy so that
 * the development service can read a projection without loading the resolver.
 */
export class Digest {
	static text(value: any): string {
		if (value === null || typeof value !== 'object') return JSON.stringify(value === void 0 ? null : value);
		if (Array.isArray(value)) return `[${value.map(item => Digest.text(item)).join(',')}]`;

		const members = Object.keys(value)
			.filter(key => value[key] !== void 0)
			.sort()
			.map(key => `${JSON.stringify(key)}:${Digest.text(value[key])}`);
		return `{${members.join(',')}}`;
	}

	static of(value: any): string {
		return `sha256-${createHash('sha256').update(Digest.text(value)).digest('hex')}`;
	}
}
