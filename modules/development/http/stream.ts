import type { Request, Response } from 'express';
import type { Log, IDevelopmentEvent } from '../log';
import type { Access } from '../access';

/**
 * The event stream, `text/event-stream`. The identifier of every message is its cursor, so a client returns
 * with `Last-Event-ID` or `?cursor=` and receives exactly the later events, or `resync` first when the
 * server cannot replay them. The stream ends with the grant that opened it.
 *
 * Source events name files and who changed them, so a grant without `files.read` does not receive them: a
 * preview visitor subscribes to learn about builds, and must not learn about the source tree through it.
 */
export class Stream {
	static HEARTBEAT = 20000;

	#log: Log;
	#access: Access;
	#open = new Set<Response>();

	constructor(log: Log, access: Access) {
		this.#log = log;
		this.#access = access;
	}

	handle(request: Request, response: Response) {
		const claims = this.#access.require(request, 'events.subscribe');
		const cursor = (request.query.cursor as string) ?? (request.headers['last-event-id'] as string);
		// An invalid cursor is refused before the stream opens
		const replay = cursor ? this.#log.since(cursor) : { events: [] as IDevelopmentEvent[] };

		response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
		const sources = !claims || claims.cap.includes('files.read');
		const send = (event: IDevelopmentEvent) => {
			if (!sources && /^(file|batch)\./.test(event.type)) return;
			response.write(`id: ${event.cursor}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
		};

		if (replay.resync) send({ cursor: this.#log.cursor, type: 'resync', reason: replay.resync });
		else replay.events.forEach(send);
		// A new subscriber learns the current cursor even when nothing is replayed
		response.write(`event: subscribed\ndata: ${JSON.stringify({ cursor: this.#log.cursor })}\n\n`);

		const unsubscribe = this.#log.subscribe(send);
		const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), Stream.HEARTBEAT);
		const release = this.#access.stream(claims, reason => {
			send({ cursor: this.#log.cursor, type: 'access.ended', reason });
			response.end();
		});

		this.#open.add(response);
		response.on('close', () => {
			unsubscribe();
			release();
			clearInterval(heartbeat);
			this.#open.delete(response);
		});
	}

	close() {
		for (const response of this.#open) {
			response.write(`event: stopping\ndata: ${JSON.stringify({ cursor: this.#log.cursor, type: 'stopping' })}\n\n`);
			response.end();
		}
	}
}
