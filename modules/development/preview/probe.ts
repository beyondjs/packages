/**
 * What the CDN answered for one address
 */
export interface IProbed {
	/**
	 * `present`: the CDN answered with the output itself, of the media type of its family and with the digest of its
	 * bytes. `missing`: it answered that it has no such output. `unverified`: it answered, but not with something this
	 * address can be bound to (a redirect, another media type, no digest). `unavailable`: it did not answer within the
	 * bound, could not be reached, or failed (5xx), which is an outage and not a refusal.
	 */
	state: 'present' | 'missing' | 'unverified' | 'unavailable';
	status?: number;

	/**
	 * Why the answer could not be bound to the address
	 */
	reason?: string;

	/**
	 * The digest of the output, from the strong entity tag the compiled-module contract defines (`sha256-<hex>`)
	 */
	digest?: string;

	/**
	 * The same digest as subresource integrity metadata (`sha256-<base64>`), which the import map pins
	 */
	integrity?: string;
}

/**
 * Checks what the CDN holds at the addresses a preview gives on it, with a `HEAD` request per address before the
 * document gives them to a browser.
 *
 * An address is bound to what the CDN answered only when the answer is the output itself: a 2xx without a redirect
 * (redirects are not followed), the media type of its family (`application/javascript` or `text/javascript` for a
 * module, `text/css` for a stylesheet) and the strong `ETag` the compiled-module contract defines as the SHA-256
 * digest of the body. That digest becomes the integrity the import map pins, so a browser refuses any other bytes.
 *
 * Every request is bounded (`BEYOND_PREVIEW_CDN_TIMEOUT`, 5 seconds by default) and at most eight run at once, so a
 * CDN that does not answer delays a document by about one bound, never indefinitely. The bound is read from the
 * environment once per check, so a change of the variable while the service runs (the `previews.timeout` setting of
 * the host writes it) applies to the next description; an empty variable is the default, and a variable the
 * environment no longer names leaves the bound this object was created with. An output the CDN answered for
 * is not asked again for ten seconds, so a description and its document read together check once; after that it is
 * checked again, because a CDN that never changes the bytes of an address can still stop serving it once nothing
 * retains it. What was missing, unverified or unanswered is asked again the next time.
 */
export class Probe {
	static VARIABLE = 'BEYOND_PREVIEW_CDN_TIMEOUT';
	static TIMEOUT = 5000;
	static PARALLEL = 8;
	static RETAINED = 10000;

	static #MEDIA: Record<string, RegExp> = { modules: /^(application|text)\/javascript\b/i, styles: /^text\/css\b/i };
	static #TAG = /^"(sha256-([0-9a-f]{64}))"$/;

	#environment: NodeJS.ProcessEnv;
	#started: number;
	#present: Map<string, { probed: IProbed; at: number }> = new Map();

	constructor(environment: NodeJS.ProcessEnv = process.env) {
		this.#environment = environment;
		this.#started = Probe.#bound(environment[Probe.VARIABLE]);
	}

	/**
	 * The milliseconds a value of the variable gives each request: a positive number, else the default
	 */
	static #bound(value: string | undefined): number {
		const configured = Number(value);
		return value && Number.isFinite(configured) && configured > 0 ? configured : Probe.TIMEOUT;
	}

	/**
	 * The bound of each request, read now
	 */
	get timeout(): number {
		const given = this.#environment[Probe.VARIABLE];
		return given === void 0 ? this.#started : Probe.#bound(given);
	}

	/**
	 * @returns What the CDN answered for each address
	 */
	async check(urls: string[]): Promise<Map<string, IProbed>> {
		const results: Map<string, IProbed> = new Map();
		const pending = [...new Set(urls)];
		// One bound for every request of a check
		const timeout = this.timeout;
		const worker = async () => {
			for (let url = pending.shift(); url; url = pending.shift()) results.set(url, await this.#one(url, timeout));
		};
		await Promise.all(Array.from({ length: Math.min(Probe.PARALLEL, pending.length) }, worker));
		return results;
	}

	async #one(url: string, timeout: number): Promise<IProbed> {
		const known = this.#present.get(url);
		if (known && Date.now() - known.at < Probe.RETAINED) return known.probed;
		this.#present.delete(url);

		let probed: IProbed;
		try {
			const response = await fetch(url, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(timeout) });
			probed = Probe.#answer(url, response);
		} catch {
			probed = { state: 'unavailable' };
		}
		if (probed.state !== 'present') return probed;

		// The oldest answer leaves first, so a long-lived service keeps a bounded number of them
		this.#present.size >= 4096 && this.#present.delete(this.#present.keys().next().value);
		this.#present.set(url, { probed, at: Date.now() });
		return probed;
	}

	/**
	 * What an answer binds the address to
	 */
	static #answer(url: string, response: Response): IProbed {
		const { status } = response;
		if (status >= 500) return { state: 'unavailable', status };
		if (status >= 300 && status < 400) return { state: 'unverified', status, reason: 'it answered with a redirect, not with the output' };
		if (status >= 400) return { state: 'missing', status };

		const family = /\/(modules|styles)\//.exec(new URL(url).pathname)?.[1];
		const media = response.headers.get('content-type') ?? '';
		const expected = family === 'styles' ? 'a stylesheet' : 'a module';
		if (family && !Probe.#MEDIA[family].test(media)) return { state: 'unverified', status, reason: `it answered "${media || 'no media type'}", not the media type of ${expected}` };

		const tag = Probe.#TAG.exec(response.headers.get('etag') ?? '');
		if (!tag) return { state: 'unverified', status, reason: 'it answered without the strong sha256 entity tag that identifies the bytes of the output' };
		return { state: 'present', status, digest: tag[1], integrity: `sha256-${Buffer.from(tag[2], 'hex').toString('base64')}` };
	}
}
