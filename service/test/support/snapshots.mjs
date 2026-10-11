import { createHash } from 'node:crypto';
import { createServer } from 'node:http';

/**
 * A stand-in for the archive route of Snapshots (`PUT /v1/captures/:id/archive?package=<path>` with
 * `Authorization: Grant <token>`), on an ephemeral loopback port. It records every upload that arrives (its path,
 * headers, size and SHA-256) and answers as the case says, per package path:
 *
 * - `store` (default): `201` with the stored package;
 * - `refuse`: `409` with `{error: {code: 'GRANT_USED'}}`;
 * - `unavailable`: `503` with `{error: {code: 'UNAVAILABLE'}}`;
 * - `redirect`: `307` to another address, which counts the requests that follow it in `followed`;
 * - `drop`: reads the body and ends the connection without an answer;
 * - `stall`: reads the body and never answers;
 * - `slow`: answers `201` after `delay` ms, counting how many uploads it holds at once in `concurrency`.
 *
 * It always listens on `127.0.0.1`; `host` names its origin otherwise, as the suite's local composition names
 * Snapshots `http://snapshots.beyond.localhost:<port>`.
 *
 * ```js
 * const snapshots = await stand(t, { behaviors: { '.': 'drop' } });
 * snapshots.uploads;   // [{path, capture, authorization, type, length, bytes, digest, host, url}]
 * ```
 *
 * @param {import('node:test').TestContext} t
 * @param {{behaviors?: Record<string, string>, delay?: number, host?: string}} [options]
 */
export const stand = async (t, { behaviors = {}, delay = 100, host = '127.0.0.1' } = {}) => {
	const uploads = [];
	const aborted = [];
	let followed = 0;
	let holding = 0;
	let concurrency = 0;
	const sockets = new Set();

	const server = createServer(async (request, response) => {
		const url = new URL(request.url, 'http://stand');
		if (url.pathname === '/followed') {
			followed++;
			return response.writeHead(201).end('{}');
		}
		const path = url.searchParams.get('package');
		const chunks = [];
		let complete = false;
		request.on('close', () => !complete && aborted.push(path));
		for await (const chunk of request) chunks.push(chunk);
		complete = true;
		const bytes = Buffer.concat(chunks);
		uploads.push({
			path,
			capture: url.pathname.split('/')[3],
			authorization: request.headers.authorization,
			type: request.headers['content-type'],
			length: Number(request.headers['content-length']),
			bytes: bytes.length,
			digest: createHash('sha256').update(bytes).digest('hex'),
			host: request.headers.host,
			url: request.url
		});

		const behavior = behaviors[path] ?? 'store';
		const json = (status, body) => response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
		if (behavior === 'refuse') return json(409, { error: { code: 'GRANT_USED', message: 'This grant was used for other bytes' } });
		if (behavior === 'unavailable') return json(503, { error: { code: 'UNAVAILABLE', message: 'Storage is not answering' } });
		if (behavior === 'redirect') return response.writeHead(307, { location: `http://127.0.0.1:${server.address().port}/followed` }).end();
		if (behavior === 'drop') return request.socket.destroy();
		if (behavior === 'stall') return;
		if (behavior === 'slow') {
			concurrency = Math.max(concurrency, ++holding);
			await new Promise(resolve => setTimeout(resolve, delay));
			holding--;
		}
		json(201, { package: { path, digest: uploads.at(-1).digest, stored: true } });
	});
	server.on('connection', socket => {
		sockets.add(socket);
		socket.on('close', () => sockets.delete(socket));
	});
	server.listen(0, '127.0.0.1');
	await new Promise(resolve => server.once('listening', resolve));
	t.after(() => {
		sockets.forEach(socket => socket.destroy());
		return new Promise(resolve => server.close(resolve));
	});
	const origin = `http://${host}:${server.address().port}`;

	return {
		origin,
		uploads,
		aborted,
		get followed() {
			return followed;
		},
		get concurrency() {
			return concurrency;
		},
		/**
		 * One grant per path for a capture, on this stand-in
		 */
		grants: (capture, paths, { expires = new Date(Date.now() + 900000).toISOString() } = {}) =>
			paths.map(path => ({ path, upload: `${origin}/v1/captures/${capture}/archive?package=${encodeURIComponent(path)}`, token: `grant-${path}-secret`, expires }))
	};
};
