/**
 * A stand-in for the supervisor of a development service, started by a test the way `Service` starts the
 * real one: detached, with an IPC channel. It does what its first argument says.
 *
 * - `silent`: never reports an outcome, and ends when it is asked to (`SIGTERM`).
 * - `stubborn`: never reports an outcome and ignores `SIGTERM`. It starts a child in its own process group
 *   and writes that child's pid to the file named by its second argument, so a test can check that the
 *   group was ended.
 * - `ready`: reports a ready record at once, as a supervisor whose host became ready.
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const [mode, file] = process.argv.slice(2);

// Kept alive until it is ended
setInterval(() => void 0, 60000);

if (mode === 'silent') process.on('SIGTERM', () => process.exit(0));
if (mode === 'stubborn') {
	process.on('SIGTERM', () => void 0);
	const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 60000)'], { stdio: 'ignore' });
	writeFileSync(file, String(child.pid));
}
if (mode === 'ready') process.send({ ready: { pid: process.pid, origin: 'http://127.0.0.1:1', log: 'stand-in.log' } });
