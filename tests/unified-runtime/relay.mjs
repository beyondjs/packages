/**
 * The external emitter of the validations: it stands for any emitter other than the development service,
 * such as a Workspace administration that holds the events of an environment. It is a stand-in and is named
 * as such: it reads the event stream of the service like any subscriber, connects again with its cursor when
 * the stream ends, and relays every event document unchanged — the `resync` of a service that restarted
 * included — to the consumers that subscribed to it: over an event stream of its own, at another origin,
 * and to listeners in this process.
 */
import { createServer } from 'node:http';
import { timeout } from '../stage-1/harness.mjs';

export class Relay {
	#upstream;
	#headers;
	#controller;
	#cursor;
	#closed = false;
	#server;
	#clients = new Set();
	#listeners = new Set();

	/**
	 * The event documents relayed so far
	 */
	events = [];

	#origin;

	/**
	 * The address of its own event stream
	 */
	get url() {
		return `${this.#origin}/stream`;
	}

	#subscribed;

	/**
	 * @param upstream The event stream of the service
	 * @param headers What the requests to the service send
	 */
	async start(upstream, headers = {}) {
		this.#upstream = upstream;
		this.#headers = headers;

		this.#server = createServer((request, response) => {
			const cors = { 'access-control-allow-origin': '*' };
			if (!request.url.startsWith('/stream')) return void response.writeHead(404, cors).end();
			response.writeHead(200, { ...cors, 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
			response.write(`event: subscribed\ndata: ${JSON.stringify({ cursor: this.#cursor ?? null })}\n\n`);
			this.#clients.add(response);
			response.on('close', () => this.#clients.delete(response));
		});
		this.#origin = await new Promise(done => this.#server.listen(0, '127.0.0.1', () => done(`http://127.0.0.1:${this.#server.address().port}`)));

		const subscribed = new Promise(resolve => (this.#subscribed = resolve));
		this.#run();
		await Promise.race([subscribed, timeout(30000, 'relay subscribed')]);
		return this;
	}

	/**
	 * Adds a listener of the relayed documents
	 *
	 * @returns What releases it
	 */
	on(listener) {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	/**
	 * Resolves with the first relayed document after position `from` that matches
	 */
	async until(match, from = 0, ms = 60000) {
		for (const deadline = Date.now() + ms; Date.now() < deadline; await new Promise(resolve => setTimeout(resolve, 50))) {
			const found = this.events.slice(from).find(match);
			if (found) return found;
		}
		throw new Error('The relay received no matching event in time');
	}

	#relay(event) {
		this.events.push(event);
		const frame = `${event.cursor ? `id: ${event.cursor}\n` : ''}event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
		this.#clients.forEach(response => response.write(frame));
		this.#listeners.forEach(listener => listener(event));
	}

	/**
	 * Reads the stream of the service, and reads it again with the last cursor whenever it ends
	 */
	async #run() {
		while (!this.#closed) {
			try {
				await this.#read();
			} catch {
				// The service stopped, or was not listening yet: it is read again below
			}
			if (this.#closed) return;
			await new Promise(resolve => setTimeout(resolve, 100));
		}
	}

	async #read() {
		this.#controller = new AbortController();
		const query = this.#cursor ? `?cursor=${encodeURIComponent(this.#cursor)}` : '';
		const response = await fetch(`${this.#upstream}${query}`, { headers: this.#headers, signal: this.#controller.signal });
		if (!response.ok) throw new Error(`The event stream of the service answered HTTP ${response.status}`);

		let buffer = '';
		for await (const chunk of response.body) {
			buffer += Buffer.from(chunk).toString('utf8');
			for (let end; (end = buffer.indexOf('\n\n')) >= 0; buffer = buffer.slice(end + 2)) {
				const block = buffer.slice(0, end);
				const type = /^event: (.*)$/m.exec(block)?.[1];
				const data = /^data: (.*)$/m.exec(block)?.[1];
				if (!data) continue;
				const event = JSON.parse(data);
				if (type === 'subscribed') {
					this.#cursor ??= event.cursor;
					this.#subscribed?.();
					continue;
				}
				event.cursor && (this.#cursor = event.cursor);
				this.#relay({ ...event, type: event.type ?? type });
			}
		}
	}

	stop() {
		this.#closed = true;
		this.#controller?.abort();
		this.#clients.forEach(response => response.end());
		this.#server?.closeAllConnections();
		this.#server?.close();
	}
}
