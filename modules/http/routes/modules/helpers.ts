import type { Request, Response } from 'express';
import { createHash } from 'crypto';

/**
 * Helper class to parse and validate query parameters.
 */
export class Parse {
	static bool(v: unknown, d: boolean): boolean {
		if (v === undefined) return d;
		if (typeof v === 'boolean') return v;
		const s = String(v).toLowerCase();
		return s === '1' || s === 'true' || s === 'yes';
	}

	static one<T extends string>(v: unknown, list: readonly T[], d?: T): T {
		const s = typeof v === 'string' ? v : '';
		if ((list as readonly string[]).includes(s)) return s as T;
		if (d !== undefined) return d;
		throw new Error(`Invalid value "${v}" (expected: ${list.join(', ')})`);
	}
}

/**
 * Helper class to manage ETag generation and validation for HTTP responses.
 */
export class Tag {
	static etag(content: string): string {
		const hex = createHash('sha256').update(content).digest('hex'); // 64 hex
		return `"sha256-${hex}"`; // strong etag
	}

	static notmod(req: Request, res: Response, tag: string): boolean {
		const inm = req.headers['if-none-match'];
		if (!inm) return false;

		const list = String(inm)
			.split(',')
			.map(s => s.trim());

		if (list.includes(tag)) {
			res.status(304).end();
			return true;
		}
		return false;
	}
}
