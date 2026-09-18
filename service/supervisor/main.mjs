/**
 * The supervisor of one development service. It is started detached by whoever needs the service and owns
 * every process the service consists of.
 *
 * It asks the implementation of this installation to prepare itself, which is nothing for a compiled
 * distribution and the transitional bootstrap for one that carries sources, and starts the host as that
 * preparation describes. The host is the Node process where Packages runs: it compiles the workspace,
 * serves its modules and decides when the service ends, according to who is attached to it.
 *
 * The supervisor publishes the discovery record once the host is ready and removes it when the host ends,
 * whatever the reason, after stopping what the preparation started. Nothing here knows how the
 * implementation is prepared: that is the separation that lets a compiled Packages run without Engine.
 */
import { spawn } from 'node:child_process';
import { appendFileSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Discovery } from '../discovery.mjs';
import { Home } from '../home.mjs';
import { Installation } from '../installation.mjs';
import { Implementation } from '../implementation.mjs';

const options = JSON.parse(process.env.BEYOND_SERVICE_OPTIONS);
const report = message => process.connected && process.send(message);

const installation = new Installation();
const home = new Home(options.home);
const discovery = new Discovery(home, { root: options.root, toolchain: installation.id });
const directory = home.directory('services', discovery.key);
const log = join(directory, 'service.log');

let implementation;
let host;
let ending = false;

/**
 * Ends the service: the host first, which notifies its clients, then the bootstrap, then the record
 */
async function end(code) {
	if (ending) return;
	ending = true;

	if (host && host.exitCode === null) {
		const exited = new Promise(resolve => host.once('exit', resolve));
		host.kill('SIGTERM');
		await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 8000))]);
		host.exitCode === null && host.kill('SIGKILL');
	}

	await implementation?.stop();
	discovery.remove(process.pid);
	await sweep();
	process.exit(code);
}

/**
 * Ends whatever is left in the process group of this supervisor. The supervisor is started detached, so it
 * leads a group that the host and everything the host started belong to: the watchers service and the
 * monitor it forks. A host that stops normally ends them itself; one that was killed or crashed cannot, and
 * its descendants would be adopted by the system and run forever. This process is part of the group and
 * survives the first signal because it handles it; the second one is its own end as well.
 */
async function sweep() {
	if (process.platform === 'win32') return;

	const signal = name => {
		try {
			process.kill(-process.pid, name);
		} catch {
			// Not a group leader (started by hand): there is no group to sweep
		}
	};

	signal('SIGTERM');
	await new Promise(resolve => setTimeout(resolve, 500));
	discovery.remove(process.pid);
	signal('SIGKILL');
}

['SIGTERM', 'SIGINT', 'SIGHUP'].forEach(signal => process.on(signal, () => end(0)));

// The launcher disconnects once it knows the outcome of the start; the service does not depend on it
process.on('disconnect', () => {});

try {
	implementation = await Implementation.provider(installation);
	const launch = await implementation.prepare({ directory, log });

	const output = openSync(log, 'a');
	const settings = {
		...options,
		versions: { ...installation.versions, ...launch.versions },
		toolchain: installation.id,
		runtime: installation.runtime,
		watchers: launch.watchers
	};

	host = spawn(process.execPath, [...launch.execArgv, fileURLToPath(new URL('../host/main.mjs', import.meta.url))], {
		cwd: launch.cwd,

		/**
		 * The host has no IPC channel. The implementation's IPC utility takes a process that has one for a
		 * child of its own router and forwards every request to the parent, which would leave the watcher
		 * clients of the host waiting for answers from this supervisor. The host reports its start through
		 * an ordinary pipe (fd 3), and notices the end of the supervisor when its stdin closes.
		 */
		stdio: ['pipe', output, output, 'pipe'],
		env: {
			...process.env,
			NODE_OPTIONS: '',
			BEE_URL: '',
			BEE_ADAPTER: '',
			BEE_IMPORT_MAP: '',
			...launch.env,
			BEYOND_SERVICE_OPTIONS: '',
			BEYOND_HOST_OPTIONS: JSON.stringify(settings)
		}
	});

	/**
	 * The inventory of this start, one line per start of the service. Some of these processes rename
	 * themselves, so a process listing cannot attribute them by command; their process group can: the one
	 * this supervisor leads (the host and its descendants) and the ones the preparation started. Whoever verifies that a stopped service left nothing behind checks
	 * these identifiers.
	 */
	const inventory = { supervisor: process.pid, host: host.pid, groups: [process.pid, ...launch.groups] };
	appendFileSync(join(directory, 'processes.jsonl'), `${JSON.stringify(inventory)}\n`);

	let reported = '';
	host.stdio[3].setEncoding('utf8').on('data', chunk => {
		reported += chunk;
		if (!reported.includes('\n')) return;

		const message = JSON.parse(reported.slice(0, reported.indexOf('\n')));
		reported = '';
		if (message.failed) return report({ failed: message.failed, log });
		if (!message.ready) return;

		const record = {
			pid: process.pid,
			origin: message.ready.origin,
			root: options.root,
			toolchain: installation.id,
			lifetime: options.lifetime,
			started: new Date().toISOString(),
			log
		};
		discovery.write(record);
		report({ ready: record });
	});

	host.once('exit', code => {
		!ending && report({ failed: `The service host exited (${code}) before it was ready`, log });
		end(code ?? 1);
	});
} catch (error) {
	report({ failed: error.message, log });
	await end(1);
}
