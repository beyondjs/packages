import assert from 'node:assert/strict';
import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import express from 'express';
import { Project, revision, step, wait } from './harness.mjs';

const { Access, Development, Verifier } = await import('@beyond-js/packages/development');

const fixture = name => JSON.parse(readFileSync(new URL(`../../contracts/development/fixtures/grants/${name}.json`, import.meta.url), 'utf8'));
const vectors = fixture('vectors');
const keys = fixture('keys');

/**
 * Signs grants and revocation lists with the public test key, as the central administration does with its own
 */
class Signer {
	#key = createPrivateKey(keys.trusted.private);
	#sequence = 0;

	#serialize(typ, payload) {
		const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
		const signed = `${encode({ alg: 'EdDSA', typ, kid: keys.trusted.kid })}.${encode(payload)}`;
		return `${signed}.${sign(null, Buffer.from(signed), this.#key).toString('base64url')}`;
	}

	grant(id, cap, { sub = 'usr_ana0001', act = { kind: 'user' }, ttl = 900 } = {}) {
		const iat = Math.floor(Date.now() / 1000);
		const { issuer: iss, environment: aud } = vectors.verifier;
		return this.#serialize('beyond-dev-grant/1', { iss, aud, sub, prj: 'prj_shop0001', jti: id, iat, exp: iat + ttl, cap, act });
	}

	revocations(grants, sequence = ++this.#sequence) {
		const { issuer: iss, environment: aud } = vectors.verifier;
		return this.#serialize('beyond-dev-revocations/1', { iss, aud, seq: sequence, iat: Math.floor(Date.now() / 1000), grants, subjects: [] });
	}
}

/**
 * Stands in for Packages' delivery so that build correlation can be driven deterministically. It compiles
 * nothing: a source containing `= ;` fails. Real compilation is validated through the hosting service.
 */
class Delivery {
	constructor(project) {
		this.project = project;
	}
	async published() {
		return [{ vspecifier: '@case/app@1.0.0/main', name: '@case/app', version: '1.0.0', subpath: './main' }];
	}
	async module() {
		const source = readFileSync(this.project.file('app/main/index.ts'), 'utf8');
		return source.includes('= ;')
			? { failure: { code: 'BUILD_FAILED', message: 'failed', diagnostics: [{ code: 'TS1109', message: 'Expression expected.' }] } }
			: { delivered: { hash: revision(source).slice(7, 15) } };
	}
}

const serve = async (seed, access) => {
	const project = new Project(seed);
	const development = new Development({ delivery: new Delivery(project), settings: { root: project.path } }, access);
	const app = express();
	development.guard(app);
	app.get('/session', (request, response) => response.json({ protocol: 'beyond-dev-session/1' }));
	await development.setup(app);
	const server = await new Promise(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
	const origin = `http://127.0.0.1:${server.address().port}`;

	const call = async (method, path, { grant, headers = {}, body } = {}) => {
		const response = await fetch(origin + path, { method, body, headers: { ...(grant ? { authorization: `Bearer ${grant}` } : {}), ...headers } });
		const text = await response.text();
		let parsed;
		try { parsed = JSON.parse(text); } catch { parsed = text; }
		return { status: response.status, headers: response.headers, body: parsed };
	};
	/**
	 * Opens the event stream and collects its messages until it ends or `close()` is called
	 */
	const subscribe = async ({ grant, cursor } = {}) => {
		const controller = new AbortController();
		const response = await fetch(`${origin}/events${cursor ? `?cursor=${cursor}` : ''}`, { signal: controller.signal, headers: grant ? { authorization: `Bearer ${grant}` } : {} });
		const messages = [];
		const state = { status: response.status, messages, ended: false, close: () => controller.abort() };
		if (response.status !== 200) return { ...state, body: await response.json() };
		(async () => {
			let buffer = '';
			try {
				for await (const chunk of response.body) {
					buffer += Buffer.from(chunk).toString('utf8');
					for (let end; (end = buffer.indexOf('\n\n')) >= 0; buffer = buffer.slice(end + 2)) {
						const data = /^data: (.*)$/m.exec(buffer.slice(0, end))?.[1];
						data && messages.push({ event: /^event: (.*)$/m.exec(buffer.slice(0, end))?.[1], ...JSON.parse(data) });
					}
				}
			} catch {}
			state.ended = true;
		})();
		return state;
	};
	const stop = () => (development.stop(), server.closeAllConnections(), server.close(), project.remove());
	return { project, development, call, subscribe, stop };
};

const until = async (check, what, timeout = 5000) => {
	for (const deadline = Date.now() + timeout; Date.now() < deadline; await wait(25)) if (check()) return;
	throw new Error(`Timed out waiting for ${what}`);
};

export async function service() {
	await step('grant vectors: the Packages verifier produces the outcome the administration contract requires for all 13', async () => {
		for (const vector of vectors.grants) {
			const verifier = new Verifier(vectors.verifier);
			for (const name of Object.keys(vectors.revocations)) {
				if (!vector.revocations) break;
				verifier.revocations(vectors.revocations[name]);
				if (name === vector.revocations) break;
			}
			let outcome = 'accepted';
			try { verifier.verify(vector.token, vector.capability, vector.at); } catch (error) { outcome = error.code; }
			assert.equal(outcome, vector.expect, vector.name);
		}
		return `${vectors.grants.length} vectors`;
	});

	const signer = new Signer();
	const delegated = () => new Access(vectors.verifier);
	const writer = ['session.read', 'files.read', 'files.write', 'events.subscribe', 'inspect.read', 'build.control'];

	await step('no-grant-no-access: every route, including the host\'s own, refuses a request without a grant', async () => {
		const context = await serve({ 'a.ts': 'one' }, delegated());
		for (const [method, path] of [['GET', '/files/tree'], ['GET', '/files/content/a.ts'], ['GET', '/session'], ['POST', '/builds'], ['GET', '/events']]) {
			const { status, body } = await context.call(method, path);
			assert.deepEqual([status, body.error.code], [401, 'GRANT_MALFORMED'], path);
		}
		context.stop();
	});

	await step('HTTP preconditions: create, entity tag, not-modified, required precondition, stale write, delete', async () => {
		const context = await serve({}, delegated());
		const grant = signer.grant('grt_http0001', writer, { act: { kind: 'agent', task: 'tsk_0001' } });
		const path = '/files/content/app/my%20file.ts';

		assert.equal((await context.call('PUT', path, { grant, body: 'x' })).body.error.code, 'PRECONDITION_REQUIRED');
		const created = await context.call('PUT', path, { grant, body: 'one', headers: { 'if-none-match': '*' } });
		assert.deepEqual([created.status, created.body.revision], [200, revision('one')]);
		assert.equal((await context.call('PUT', path, { grant, body: 'again', headers: { 'if-none-match': '*' } })).status, 409);

		const read = await context.call('GET', path, { grant });
		assert.deepEqual([read.body, read.headers.get('etag')], ['one', `"${revision('one')}"`]);
		assert.equal((await context.call('GET', path, { grant, headers: { 'if-none-match': `"${revision('one')}"` } })).status, 304);

		const stale = await context.call('PUT', path, { grant, body: 'lost', headers: { 'if-match': `"${revision('zero')}"` } });
		assert.deepEqual([stale.status, stale.body.conflict.current], [409, revision('one')]);
		const tree = await context.call('GET', '/files/tree', { grant });
		assert.deepEqual(tree.body.entries.filter(({ kind }) => kind === 'file').map(({ path: name }) => name), ['app/my file.ts']);

		const replay = await context.subscribe({ grant, cursor: `${tree.body.cursor.split(':')[0]}:0` });
		await until(() => replay.messages.some(({ event }) => event === 'subscribed'), 'replay');
		assert.deepEqual(replay.messages[0].actor, { sub: 'usr_ana0001', kind: 'agent', task: 'tsk_0001' });
		replay.close();

		assert.equal((await context.call('DELETE', path, { grant, headers: { 'if-match': `"${revision('one')}"` } })).body.outcome, 'completed');
		assert.equal((await context.call('GET', path, { grant })).body.error.code, 'FILE_NOT_FOUND');
		context.stop();
		return 'the replayed creation event carries the agent task of the grant';
	});

	await step('viewer-cannot-write and revocation-ends-subscription', async () => {
		const context = await serve({ 'a.ts': 'one' }, delegated());
		const viewer = signer.grant('grt_view0001', ['files.read', 'events.subscribe'], { sub: 'usr_bob0002' });
		assert.equal((await context.call('GET', '/files/tree', { grant: viewer })).status, 200);
		const refused = await context.call('PUT', '/files/content/a.ts', { grant: viewer, body: 'x', headers: { 'if-match': `"${revision('one')}"` } });
		assert.deepEqual([refused.status, refused.body.error.code], [403, 'GRANT_CAPABILITY']);

		const stream = await context.subscribe({ grant: viewer });
		await until(() => stream.messages.length, 'subscription');
		const list = signer.revocations(['grt_view0001']);
		assert.equal((await context.call('PUT', '/access/revocations', { body: list })).status, 204);
		await until(() => stream.ended, 'the revoked stream to end');
		assert.deepEqual(stream.messages.at(-1).reason, 'GRANT_REVOKED');
		assert.equal((await context.call('GET', '/files/tree', { grant: viewer })).body.error.code, 'GRANT_REVOKED');
		assert.deepEqual((await context.call('PUT', '/access/revocations', { body: list })).body.error.code, 'REVOCATIONS_STALE');

		const expiring = await context.subscribe({ grant: signer.grant('grt_short001', ['events.subscribe'], { ttl: 1 }) });
		await until(() => expiring.ended, 'the expired stream to end');
		assert.equal(expiring.messages.at(-1).reason, 'GRANT_EXPIRED');
		context.stop();
	});

	await step('stale-build-is-superseded, failed-build-then-recovery, and a batch is built once (stub delivery)', async () => {
		const context = await serve({ 'app/main/index.ts': 'export const v = 1;' });
		const events = [];
		context.development.files.log.subscribe(event => events.push(event));
		const ended = () => events.filter(({ type }) => type === 'build.ended').map(({ build }) => build);
		const source = () => revision(readFileSync(context.project.file('app/main/index.ts')));

		let release;
		context.development.builds.hold = new Promise(resolve => (release = resolve));
		const slow = (await context.call('POST', '/builds')).body;
		await context.call('PUT', '/files/content/app/main/index.ts', { body: 'export const v = ;', headers: { 'if-match': `"${source()}"` } });
		release();
		await until(() => ended().length >= 2, 'both builds to end');
		assert.equal(ended().find(({ id }) => id === slow.id).state, 'superseded');
		const failed = ended().find(({ id }) => id !== slow.id);
		assert.deepEqual([failed.state, failed.diagnostics[0].code], ['failed', 'TS1109']);

		await context.call('PUT', '/files/content/app/main/index.ts', { body: 'export const v = 3;', headers: { 'if-match': `"${source()}"` } });
		await until(() => ended().length >= 3, 'the recovery build');
		const recovered = ended().at(-1);
		assert.equal(recovered.state, 'completed');
		assert.ok(context.development.files.log.sequence(recovered.input) > context.development.files.log.sequence(failed.input));

		const before = events.filter(({ type }) => type === 'build.started').length;
		const mutations = ['x', 'y', 'z'].map(name => ({ operation: 'write', path: `app/${name}.ts`, expected: 'absent', content: name }));
		await context.call('POST', '/files/operations', { body: JSON.stringify({ mutations }) });
		await wait(600);
		assert.equal(events.filter(({ type }) => type === 'build.started').length - before, 1);
		context.stop();
		return 'local mode (no authority): requests need no grant';
	});
}
