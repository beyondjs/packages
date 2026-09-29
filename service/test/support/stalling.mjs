import { createServer } from 'node:http';
import { EventEmitter } from 'node:events';

/**
 * A stand-in for a development service that is there and does not answer, on an ephemeral loopback port.
 *
 * - `silent`: accepts the connection and never answers.
 * - `headers`: answers `200` with a JSON content type and never sends the body.
 * - `unavailable`: answers `503` with the service's error document, as a reload that did not settle.
 * - `attached`: answers an attachment with its `attached` event, announcing `heartbeat` milliseconds, and
 *   then writes `beats` heartbeats (none by default) and stays silent with the connection open.
 *
 * Every connection it holds is destroyed by `close()`, so a test ends even though nothing was answered.
 */
export class StallingServer extends EventEmitter {
	#server;
	#mode;
	#heartbeat;
	#beats;
	#sockets = new Set();

	get origin() {
		return `http://127.0.0.1:${this.#server.address().port}`;
	}

	/**
	 * @param {'silent' | 'headers' | 'unavailable' | 'attached'} mode
	 * @param {{heartbeat?: number, beats?: number}} [options]
	 */
	constructor(mode, { heartbeat = 40, beats = 0 } = {}) {
		super();
		this.#mode = mode;
		this.#heartbeat = heartbeat;
		this.#beats = beats;
		this.#server = createServer((request, response) => this.#answer(request, response));
		this.#server.on('connection', socket => {
			this.#sockets.add(socket);
			socket.on('close', () => this.#sockets.delete(socket));
		});
	}

	/**
	 * @returns {Promise<StallingServer>}
	 */
	async listen() {
		await new Promise(resolve => this.#server.listen(0, '127.0.0.1', resolve));
		return this;
	}

	#answer(request, response) {
		this.emit('request', request.url);
		if (this.#mode === 'silent') return;
		if (this.#mode === 'headers') return response.writeHead(200, { 'content-type': 'application/json' }).flushHeaders();
		if (this.#mode === 'unavailable') {
			const error = { code: 'UNAVAILABLE', message: 'The workspace is being reloaded' };
			return response.writeHead(503, { 'content-type': 'application/json' }).end(JSON.stringify({ error }));
		}

		response.writeHead(200, { 'content-type': 'text/event-stream' });
		response.write(`event: attached\ndata: ${JSON.stringify({ id: 'stand-in', kind: 'session', heartbeat: this.#heartbeat })}\n\n`);
		let written = 0;
		const timer = setInterval(() => {
			if (written === this.#beats) {
				clearInterval(timer);
				return this.emit('silent');
			}
			response.write(': heartbeat\n\n');
			this.emit('beat', ++written);
		}, this.#heartbeat);
		response.on('close', () => clearInterval(timer));
	}

	close() {
		this.#sockets.forEach(socket => socket.destroy());
		return new Promise(resolve => this.#server.close(resolve));
	}
}
