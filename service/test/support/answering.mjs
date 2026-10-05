import { createServer } from 'node:http';

/**
 * A stand-in for a development service that answers: each route (`GET /session`, `POST /installation`, …) answers
 * the status and JSON body a case gives it, and every request is recorded with its method, path, content type and
 * body, so a case can assert what a client sent. A route the case did not give answers `404 NOT_FOUND`, as the
 * service does. It listens on an ephemeral loopback port.
 *
 * An answer `{drop: true}` ends the connection once the request was read, as a service that dies while it
 * works; `{status, text}` answers a body that is not JSON, as a gateway in front of a service does.
 *
 * ```js
 * const service = await new AnsweringServer({ 'GET /session': { status: 200, body: session } }).listen();
 * ```
 */
export class AnsweringServer {
	#server;
	#routes;
	#requests = [];

	/**
	 * What the service received, in order: `{method, path, type, body}`, the body parsed when it was JSON
	 */
	get requests() {
		return this.#requests;
	}

	get origin() {
		return `http://127.0.0.1:${this.#server.address().port}`;
	}

	/**
	 * @param {Record<string, {status: number, body: unknown} | ((body: unknown) => {status: number, body: unknown})>}
	 * routes Keyed by `<METHOD> <path>`; a function answers from the parsed body of the request
	 */
	constructor(routes) {
		this.#routes = routes;
		this.#server = createServer((request, response) => this.#answer(request, response));
	}

	/**
	 * @returns {Promise<AnsweringServer>}
	 */
	async listen() {
		await new Promise(resolve => this.#server.listen(0, '127.0.0.1', resolve));
		return this;
	}

	async #answer(request, response) {
		const chunks = [];
		for await (const chunk of request) chunks.push(chunk);
		const text = Buffer.concat(chunks).toString('utf8');
		const type = request.headers['content-type'];
		const path = request.url.split('?')[0];

		let body = text || void 0;
		try {
			body = text && type === 'application/json' ? JSON.parse(text) : body;
		} catch {
			// Recorded as it arrived
		}
		this.#requests.push({ method: request.method, path, type, body });

		const route = this.#routes[`${request.method} ${path}`];
		const answer = typeof route === 'function' ? route(body) : route ?? { status: 404, body: { error: { code: 'NOT_FOUND', message: `No route for ${path}` } } };
		if (answer.drop) return request.socket.destroy();
		if (answer.text !== undefined) return response.writeHead(answer.status, { 'content-type': 'text/html' }).end(answer.text);
		response.writeHead(answer.status, { 'content-type': 'application/json' }).end(JSON.stringify(answer.body));
	}

	close() {
		this.#server.closeAllConnections();
		return new Promise(resolve => this.#server.close(resolve));
	}
}
