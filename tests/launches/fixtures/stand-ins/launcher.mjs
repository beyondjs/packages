/**
 * Stands for the command line's launcher (`node --import <register> <launcher> <specifier>`): instead of importing the
 * public specifier it is given, it behaves as the specifier names (`stand-in/<behavior>`), so the unit tests of the
 * launches feature drive every state of a launch without a development service or a loader. Each behavior is described
 * in the README of this directory.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';

const [specifier = ''] = process.argv.slice(2);
const behavior = specifier.replace(/^stand-in\//, '');
const keep = () => setInterval(() => void 0, 1000);
const end = () => process.once('SIGTERM', () => process.exit(0));

/**
 * What the process received: the registration that ran before it, its directory and the variables a launch sets or
 * must never pass on
 */
const report = () => {
	const names = ['BEE_URL', 'BEE_ADAPTER', 'BEE_IMPORT_MAP', 'BEYOND_HOST_OPTIONS', 'BEYOND_SNAPSHOTS_TOKEN', 'BEYOND_AUTHORITY', 'LAUNCH_VARIABLE', 'LAUNCH_INHERITED', 'NODE_OPTIONS', 'DENO_DIR'];
	const variables = Object.fromEntries(names.map(name => [name, process.env[name] ?? null]));
	console.log(`environment ${JSON.stringify({ registered: globalThis.STAND_IN_REGISTERED ?? null, cwd: process.cwd(), argv: process.argv.slice(2), ...variables })}`);
};

const behaviors = {
	// A server that says when it listens and stops cleanly on SIGTERM
	server() {
		report();
		const server = createServer((request, response) => response.end('stand-in answer'));
		server.listen(0, '127.0.0.1', () => console.log(`stand-in listening on http://127.0.0.1:${server.address().port}`));
		process.once('SIGTERM', () => {
			console.log('stand-in stopping');
			server.close(() => process.exit(0));
		});
	},
	// Says it listens, then ignores SIGTERM: only SIGKILL ends it
	stubborn() {
		process.on('SIGTERM', () => console.log('stand-in ignores SIGTERM'));
		console.log('stand-in listening, and ignoring SIGTERM');
		keep();
	},
	// Lives without ever saying it is ready
	silent() {
		keep();
		end();
	},
	// Writes its readiness without a final newline
	partial() {
		process.stdout.write('stand-in listening without a newline');
		keep();
		end();
	},
	// Fails by itself: output on both streams, then exit code 3
	crash() {
		console.log('stand-in starting');
		console.error('stand-in failure: the port is taken');
		process.exitCode = 3;
	},
	// Does its work and ends with code 0
	finish() {
		console.log('stand-in did its work');
	},
	// More lines than the ring keeps, a line longer than its width, colors and a rewritten progress line
	flood() {
		for (let line = 1; line <= 1500; line++) console.log(`line ${line}`);
		console.log('x'.repeat(5000));
		console.log('\u001b[32mgreen\u001b[0m text');
		process.stdout.write('progress 10%\rprogress 50%\rprogress 100%\n');
		console.log('stand-in listening after the flood');
		keep();
		end();
	},
	// A line every 10 ms for a second, then ready
	chatty() {
		let count = 0;
		const timer = setInterval(() => {
			console.log(`tick ${++count}`);
			if (count < 100) return;
			clearInterval(timer);
			console.log('stand-in listening after the ticks');
		}, 10);
		keep();
		end();
	},
	// Listens on the PORT it is given and says so
	port() {
		const server = createServer((request, response) => response.end('stand-in answer'));
		server.listen(Number(process.env.PORT), '127.0.0.1', () => console.log(`stand-in listening on port ${process.env.PORT}`));
		process.once('SIGTERM', () => server.close(() => process.exit(0)));
	},
	// Listens twice on one port: the second fails as a port that is taken, with Node's own uncaught EADDRINUSE
	busy() {
		const first = createServer().listen(0, '127.0.0.1', () => createServer().listen(first.address().port, '127.0.0.1'));
	},
	// Imports a package nobody installed: Node's own ERR_MODULE_NOT_FOUND
	missing() {
		import('stand-in-not-a-dependency').then(() => console.log('imported'));
	},
	// Throws an uncaught error from a function of its own
	throws() {
		const fail = () => {
			throw new Error('stand-in failure');
		};
		setTimeout(fail, 0);
	},
	// Ends by itself while a process it started keeps its output open: the end of the launch does not wait for that output
	orphan() {
		const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: ['ignore', 'inherit', 'inherit'] });
		console.log(`stand-in left ${child.pid} holding its output`);
		child.unref();
	}
};

(behaviors[behavior] ?? (() => {
	console.error(`stand-in: no behavior "${behavior}"`);
	process.exitCode = 2;
}))();
