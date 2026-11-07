import { createServer } from 'node:http';
import process from 'node:process';
import { answer } from './routes';
import { setInterval, setTimeout } from 'node:timers';

// Importing this module starts serving: on HOST (127.0.0.1 by default) and PORT (8080 by default)
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 8080);

const server = createServer((request, response) => {
	const { status, body } = answer(request.method ?? 'GET', new URL(request.url ?? '/', 'http://service').pathname);
	response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify(body));
});

server.listen(port, host, () => console.log(`listening on http://${host}:${port}`));

// On SIGTERM: accept no new connection, let open requests finish, and end within 10 s
process.once('SIGTERM', () => {
	setTimeout(() => process.exit(0), 8000).unref();
	setInterval(() => server.closeIdleConnections(), 100).unref();
	server.close(() => process.exit(0));
});
