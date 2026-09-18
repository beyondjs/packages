import { createHash } from 'crypto';

/**
 * The identity of a file's content in the development contract: `sha256-<hex>` over its bytes.
 * The HTTP entity tag of a file is this value in quotes.
 */
export /*bundle*/ class Revision {
	static ABSENT = 'absent';
	static #pattern = /^sha256-[a-f0-9]{64}$/;

	static of(bytes: Buffer | string): string {
		return `sha256-${createHash('sha256').update(bytes).digest('hex')}`;
	}

	static valid(value: unknown): boolean {
		return typeof value === 'string' && Revision.#pattern.test(value);
	}

	/**
	 * @param header An `If-Match` or `If-None-Match` value
	 * @returns The expected state it states, or undefined when it states none this contract accepts
	 */
	static expected(header: string | undefined, none: boolean): string | undefined {
		if (!header) return;
		if (none) return header.trim() === '*' ? Revision.ABSENT : undefined;
		const value = header.trim().replace(/^W\//, '').replace(/^"|"$/g, '');
		return Revision.valid(value) ? value : undefined;
	}
}
