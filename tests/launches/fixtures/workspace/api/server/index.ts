import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

/**
 * The entry point of `@launches/api/server`, a backend target: evaluating it starts an HTTP server on a port the system
 * gives (`LAUNCH_FIXTURE_PORT` names one), says `fixture API listening on <address> (<runtime>)` once it listens, which
 * is the readiness the target declares, answers `GET /health` with the process that answered, and ends on SIGTERM.
 * The same module runs in Node.js and in Deno.
 */
const runtime = (globalThis as { Deno?: unknown }).Deno ? 'deno' : 'node';
const started = new Date().toISOString();

const answer = (request: IncomingMessage, response: ServerResponse): void => {
	if (request.method !== 'GET' || request.url !== '/health') return void response.writeHead(404).end();
	const body = { status: 'ready', runtime, pid: process.pid, started, loader: process.env.BEE_ADAPTER ?? null };
	response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify(body));
};

const server = createServer(answer);
server.listen(Number(process.env.LAUNCH_FIXTURE_PORT || 0), '127.0.0.1', () => {
	const address = server.address();
	const port = typeof address === 'object' && address ? address.port : 0;
	console.log(`fixture API listening on http://127.0.0.1:${port} (${runtime})`);
});

process.once('SIGTERM', () => {
	console.log('fixture API stopping');
	server.close(() => process.exit(0));
	server.closeIdleConnections?.();
});
