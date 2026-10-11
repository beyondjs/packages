/**
 * Whether a request came through a proxy or a tunnel, told by the headers they add: `Forwarded` and `Via`, the
 * `X-Forwarded-*` family, and the client-address headers of common tunnels and content networks (ngrok, cloudflared
 * and the port forwarding of VS Code and GitHub add `X-Forwarded-For`; Cloudflare adds `CF-Connecting-IP` and
 * `CDN-Loop`). Such a request reaches the loopback address from the tunnel's own process, often with a `Host` the
 * tunnel rewrote to a loopback one, so neither tells it from a process of this machine: these headers do.
 *
 * A forwarder that adds none, such as `ssh -R` or `socat`, which forward bytes rather than requests, cannot be told
 * from a process of this machine. A port forwarded that way needs the service's public origin (`--public-origin`),
 * behind which nobody is a local consumer.
 *
 * ```js
 * Forwarding.of(request.headers);   // 'x-forwarded-for', or undefined
 * ```
 */
export class Forwarding {
	static NAMES = Object.freeze([
		'forwarded', 'via', 'x-real-ip', 'x-client-ip', 'x-cluster-client-ip', 'x-original-host', 'x-host', 'true-client-ip',
		'cf-connecting-ip', 'fastly-client-ip', 'cdn-loop'
	]);
	static PREFIX = 'x-forwarded-';

	/**
	 * The first header of a proxy or a tunnel a request carries, if any
	 *
	 * @param {Record<string, unknown>} headers The headers of a request, by lower-case name as Node gives them
	 * @returns {string | undefined}
	 */
	static of(headers) {
		return Object.keys(headers ?? {}).find(name => name.startsWith(Forwarding.PREFIX) || Forwarding.NAMES.includes(name));
	}
}
