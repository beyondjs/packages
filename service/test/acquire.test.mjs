import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Session } from '@beyond-js/artifact-api';
import { Discovery } from '../discovery.mjs';
import { Home } from '../home.mjs';
import { Service } from '../service.mjs';
import { AnsweringServer } from './support/answering.mjs';

const DEVELOPMENT = '@beyond-js/packages/development';
const DEPARTING = fileURLToPath(new URL('./support/departing.mjs', import.meta.url));

/**
 * Sets a static of `Service` for the rest of a case
 */
const configured = (t, name, value) => {
	const previous = Service[name];
	Service[name] = value;
	t.after(() => (Service[name] = previous));
};

/**
 * A process that stands for the supervisor of a service: alive for `life` milliseconds, or until the case ends
 */
const supervisor = (t, life) => {
	const script = life ? `setTimeout(() => {}, ${life})` : 'setInterval(() => {}, 60000)';
	const child = spawn(process.execPath, ['-e', script], { stdio: 'ignore' });
	const exited = new Promise(resolve => child.once('exit', () => resolve(Date.now())));
	t.after(() => child.exitCode === null && child.signalCode === null && child.kill('SIGKILL'));
	return { pid: child.pid, exited, child };
};

/**
 * A running service as a client finds it: a stand-in that describes itself as the service of a workspace, with
 * the extensions a case gives it, and the discovery record that names it in a temporary home, with its lifetime
 * and the pid of its supervisor (this process unless the case gives another). The `status` of each description
 * is the case's (200 by default), and after `answers` descriptions the stand-in stops accepting connections, as a
 * service that ended.
 */
const running = async (t, extensions, { lifetime = 'owner', answers = Infinity, status = () => 200, pid = process.pid } = {}) => {
	const home = realpathSync(mkdtempSync(join(tmpdir(), 'beyond-acquire-')));
	t.after(() => rmSync(home, { recursive: true, force: true }));

	const context = { root: join(home, 'workspace'), standalone: false };
	const service = new Service(context, { home });
	const toolchain = service.installation.id;

	let origin;
	let answered = 0;
	const session = () => {
		++answered === answers && setTimeout(() => server.close(), 20);
		const code = status(answered);
		if (code !== 200) return { status: code, body: { error: { code: 'UNAVAILABLE', message: 'The workspace is being reloaded' } } };
		const described = { pid, toolchain, origin, ...(extensions ? { extensions } : {}) };
		const body = { protocol: Session.PROTOCOL, workspace: { root: context.root, standalone: false }, service: described,
			options: 'target=node', runtime: { packages: [], base: 'file:///installed/package.json' }, modules: {} };
		return { status: 200, body };
	};
	const server = await new AnsweringServer({ [`GET ${Session.PATH}`]: session }).listen();
	t.after(() => server.close());
	origin = server.origin;

	const record = { pid, origin, root: context.root, toolchain, lifetime, log: join(home, 'service.log') };
	const discovery = new Discovery(new Home(home), { root: context.root, toolchain });
	discovery.write(record);
	return { service, origin, discovery, answered: () => answered };
};

const failure = promise =>
	promise.then(
		value => assert.fail(`expected a failure, got ${JSON.stringify(Object.keys(value))}`),
		error => error
	);

test('a service its owner holds, without an extension the caller needs, is refused at once', async t => {
	configured(t, 'SETTLE', 60000);
	const { service, origin } = await running(t, []);

	const started = Date.now();
	const refused = await failure(service.acquire({ lifetime: 'attachments', extensions: [DEVELOPMENT] }));
	assert.ok(Date.now() - started < 5000, 'an owned service does not end by itself, so nothing is waited for');
	assert.equal(refused.name, 'ServiceError');
	assert.equal(refused.code, 'SERVICE_EXTENSIONS_MISSING');
	assert.match(refused.message, new RegExp(`without ${DEVELOPMENT}`));
	assert.ok(refused.message.includes(origin), 'it names the service that is running');
	assert.match(refused.message, /End the commands and applications that use it/);
	assert.match(refused.log, /service\.log$/);
});

test('a service that describes no extensions lacks every extension a caller names', async t => {
	const { service } = await running(t, undefined);
	await assert.rejects(service.acquire({ lifetime: 'attachments', extensions: [DEVELOPMENT] }), { code: 'SERVICE_EXTENSIONS_MISSING' });
});

test('a service that ends with its clients and still accepts connections after the settling time is in use, whatever it answers', async t => {
	configured(t, 'SETTLE', 300);
	configured(t, 'SUPERVISOR', DEPARTING);
	// From its second description on it answers that it cannot describe itself now: an answer, so it is there
	const { service, origin } = await running(t, [], { lifetime: 'attachments', status: count => (count > 1 ? 503 : 200) });

	const refused = await failure(service.acquire({ lifetime: 'attachments', extensions: [DEVELOPMENT] }));
	assert.equal(refused.code, 'SERVICE_EXTENSIONS_MISSING', 'refused, and no second service was started (that start would fail)');
	assert.match(refused.message, /is in use without/);
	assert.equal((await fetch(`${origin}/session`)).status, 503, 'the first service is still there');
});

test('a service that answers it cannot describe itself now is unavailable: its record is kept and nothing is started', async t => {
	configured(t, 'SUPERVISOR', DEPARTING);
	const { service, discovery } = await running(t, [DEVELOPMENT], { lifetime: 'attachments', status: () => 503 });

	const unavailable = await failure(service.acquire({ lifetime: 'attachments', extensions: [DEVELOPMENT] }));
	assert.equal(unavailable.name, 'ContractError');
	assert.equal(unavailable.code, 'UNAVAILABLE');
	assert.equal(unavailable.status, 503);
	assert.match(unavailable.message, /is running and cannot describe itself now \(HTTP 503\): The workspace is being reloaded/);
	assert.ok(existsSync(discovery.file), 'the record of a service that is there is not discarded');
	await assert.rejects(service.find(), { code: 'UNAVAILABLE' });
});

test('a service that stopped accepting connections is replaced only once its supervisor exited', async t => {
	configured(t, 'SETTLE', 5000);
	configured(t, 'DEPART', 5000);
	configured(t, 'SUPERVISOR', DEPARTING);
	// Its supervisor outlives its address by most of a second, as one that stops what its preparation started
	const leaving = supervisor(t, 800);
	const { service } = await running(t, [], { lifetime: 'attachments', answers: 1, pid: leaving.pid });

	const replaced = await failure(service.acquire({ lifetime: 'attachments', extensions: [DEVELOPMENT] }));
	const started = Date.now();
	assert.equal(replaced.code, 'SERVICE_START_FAILED', 'a service was started in its place (the stand-in fails as one)');
	assert.equal(replaced.log, 'departing.log', 'the record of the start that replaced it');
	assert.notEqual(leaving.child.exitCode, null, 'the previous supervisor had exited when the replacement started');
	assert.ok((await leaving.exited) <= started);
});

test('a service whose supervisor does not end within the departure bound is not replaced, and says why', async t => {
	configured(t, 'SETTLE', 5000);
	configured(t, 'DEPART', 600);
	configured(t, 'SUPERVISOR', DEPARTING);
	const leaving = supervisor(t);
	const { service } = await running(t, [], { lifetime: 'attachments', answers: 1, pid: leaving.pid });

	const refused = await failure(service.acquire({ lifetime: 'attachments', extensions: [DEVELOPMENT] }));
	assert.equal(refused.code, 'SERVICE_EXTENSIONS_MISSING', 'nothing was started beside the supervisor that is still ending');
	assert.match(refused.message, new RegExp(`stopped answering and is still ending: its supervisor \\(pid ${leaving.pid}\\) did not end within 600ms`));
	assert.match(refused.message, /Run this command again once it ended/);
	assert.equal(leaving.child.exitCode, null);
});

test('a service whose supervisor removed its record and whose address refuses connections has ended, and is replaced', async t => {
	configured(t, 'SETTLE', 5000);
	configured(t, 'DEPART', 5000);
	configured(t, 'SUPERVISOR', DEPARTING);
	// The record names this process, which stays alive: its removal, as the supervisor's last step, is the evidence
	const { service, discovery } = await running(t, [], { lifetime: 'attachments', answers: 1 });
	const removal = setTimeout(() => discovery.remove(process.pid), 400);
	t.after(() => clearTimeout(removal));

	const started = Date.now();
	const replaced = await failure(service.acquire({ lifetime: 'attachments', extensions: [DEVELOPMENT] }));
	assert.equal(replaced.code, 'SERVICE_START_FAILED', 'a service was started in its place');
	assert.ok(Date.now() - started >= 400, 'not before the record was removed');
});

test('a running service with the extensions the caller needs is reused', async t => {
	const { service, origin } = await running(t, [DEVELOPMENT, 'file:///guard.mjs']);

	const { connection, started } = await service.acquire({ lifetime: 'attachments', extensions: [DEVELOPMENT] });
	assert.equal(started, false);
	assert.equal(connection.origin, origin);
	assert.deepEqual(connection.session.service.extensions, [DEVELOPMENT, 'file:///guard.mjs']);
});

test('a caller that names no extension reuses a service whatever extensions it has', async t => {
	const { service } = await running(t, []);
	const previous = process.env.BEYOND_SERVICE_EXTENSIONS;
	delete process.env.BEYOND_SERVICE_EXTENSIONS;
	t.after(() => previous !== void 0 && (process.env.BEYOND_SERVICE_EXTENSIONS = previous));

	const { started } = await service.acquire({ lifetime: 'attachments' });
	assert.equal(started, false);
});

test('the extensions of the environment are the ones a caller that names none needs', async t => {
	const { service } = await running(t, []);
	const previous = process.env.BEYOND_SERVICE_EXTENSIONS;
	process.env.BEYOND_SERVICE_EXTENSIONS = DEVELOPMENT;
	t.after(() => (previous === void 0 ? delete process.env.BEYOND_SERVICE_EXTENSIONS : (process.env.BEYOND_SERVICE_EXTENSIONS = previous)));

	await assert.rejects(service.acquire({ lifetime: 'attachments' }), { code: 'SERVICE_EXTENSIONS_MISSING' });
});
