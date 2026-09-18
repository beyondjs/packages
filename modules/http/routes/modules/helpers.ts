import type { Request, Response } from 'express';
import { createHash } from 'crypto';

/**
 * The validators of a module response: a strong ETag computed from its bytes, and the cache policy
 */
export class Tag {
	#value: string;
	get value() {
		return this.#value;
	}

	#cache: string;

	/**
	 * @param content The body the tag identifies
	 * @param cache The Cache-Control of the response, which a 304 repeats
	 */
	constructor(content: string, cache: string) {
		const hex = createHash('sha256').update(content).digest('hex');
		this.#value = `"sha256-${hex}"`;
		this.#cache = cache;
	}

	/**
	 * Sets the validators, and answers 304 when the request already holds the current tag
	 *
	 * @returns Whether the response was completed
	 */
	current(request: Request, response: Response): boolean {
		response.setHeader('ETag', this.#value);
		response.setHeader('Cache-Control', this.#cache);

		const header = request.headers['if-none-match'];
		if (!header) return false;

		// A weak validator of the same bytes matches in If-None-Match, and "*" matches any current entity
		const tags = String(header)
			.split(',')
			.map(tag => tag.trim().replace(/^W\//, ''));
		if (!tags.includes(this.#value) && !tags.includes('*')) return false;

		response.status(304).end();
		return true;
	}
}
