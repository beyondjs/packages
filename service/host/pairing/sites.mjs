/**
 * Which pages the preview listener serves, by the Fetch Metadata a browser sends (`Sec-Fetch-Site`, `Sec-Fetch-Mode`).
 * Cross-origin headers decide only what a page reads; a classic `<script>`, a stylesheet or an image is loaded without
 * them, so a page of any site that found the port could otherwise run the workspace's browser modules (as
 * `format=system`, with a shim of its own) and apply its stylesheets. Served:
 *
 * - a navigation, to a preview or to any address, from anywhere: what it opens runs on the preview origin, which
 *   reaches nothing privileged, and another site cannot read it;
 * - a request of the preview origin itself (`same-origin`), one the person made (`none`), and one without Fetch
 *   Metadata (a process, or a browser too old to send it);
 * - a request of a page of the same site (`same-site`) while the listener is reached through a loopback name: only a
 *   page this machine serves on that loopback address is of that site, because a name made to resolve here is a site
 *   of its own and fails the `Host` check. Behind a public origin it is treated as another site's, because a
 *   forwarding domain serves the ports of other people;
 * - a request of another site from an origin the preview listener allows (its own, the interface origins and the embed
 *   origins): by its `Origin` (a module script, `fetch`, an event stream), or, for a request that carries none (a
 *   classic script, a stylesheet, an image), by the origin of its `Referer`, which a page can withhold but not forge.
 *   A file a stylesheet of the preview names is requested with that stylesheet as its `Referer`.
 *
 * Anything else is `403 SITE_REFUSED`.
 *
 * ```js
 * const refusal = Sites.refusal(request, { allows: origin => origins.previews(origin), exposed: false });
 * ```
 */
export class Sites {
	static #NAVIGATION = ['navigate', 'nested-navigate'];

	/**
	 * The origin of the page that sent a request: its `Origin`, or for a request without one, the origin of its
	 * `Referer`; undefined when neither tells it
	 */
	static #initiator(request) {
		const { origin, referer } = request.headers;
		if (origin !== undefined) return origin === 'null' ? void 0 : origin;
		if (!referer) return;
		try {
			return new URL(referer).origin;
		} catch {
			return;
		}
	}

	/**
	 * Why the preview listener refuses a request, or undefined when it serves it
	 *
	 * @param {import('node:http').IncomingMessage} request
	 * @param {{allows: (origin: string) => boolean, exposed: boolean}} context The origins the preview listener serves
	 * across sites, and whether the service is reached through a public origin
	 * @returns {{status: number, code: string, message: string} | undefined}
	 */
	static refusal(request, { allows, exposed }) {
		const site = request.headers['sec-fetch-site'];
		if (site === undefined || site === 'same-origin' || site === 'none') return;
		if (site === 'same-site' && !exposed) return;
		if (Sites.#NAVIGATION.includes(String(request.headers['sec-fetch-mode']))) return;
		const origin = Sites.#initiator(request);
		if (origin !== undefined && allows(origin)) return;
		const message = `The preview listener serves a page of another site only when it is an allowed origin (its own, an interface origin or an embed origin), and this one is ${origin ? `"${origin}"` : 'not named'}`;
		return { status: 403, code: 'SITE_REFUSED', message };
	}
}
