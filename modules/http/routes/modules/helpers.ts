import type { Request, Response } from 'express';
import type { Options } from '@beyond-js/artifact-api';
import { ContractError } from '@beyond-js/artifact-api';
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
	constructor(content: string | Uint8Array, cache: string) {
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

/**
 * A request for production is answered only by the production conditional of the module: the development
 * conditional is never delivered as production output
 */
export class Production {
	static check(options: Options, key: string): void {
		if (options.env !== 'production' || key === 'installed' || key.endsWith('/production')) return;
		const message = `This module builds no production conditional (it builds "${key}"). Request env=development&min=false, or select a bundler that builds for production`;
		throw new ContractError('OPTION_UNSUPPORTED', message);
	}
}

/**
 * A stylesheet with its source map inline: CSS carries the reference in a comment of its own syntax
 */
export class Stylesheet {
	static text(styles: { code(): string; map(format: 'base64'): string | undefined }, inline: boolean): string {
		const map = inline ? styles.map('base64') : void 0;
		return map ? `${styles.code()}\n/*# ${['sourceMappingURL'].join('')}=data:application/json;base64,${map} */\n` : styles.code();
	}
}

/**
 * The diagnostics of a failure as the compiled-module contract carries them: a code and a message. The
 * file and the position a processor reports are internal identities of this service; the message keeps
 * them as text, and the development contract carries them located inside the served root.
 */
export class Diagnostics {
	static shared(diagnostics?: { code: string; message: string }[]): { code: string; message: string }[] | undefined {
		return diagnostics?.map(({ code, message }) => ({ code, message }));
	}
}
