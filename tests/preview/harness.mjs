/**
 * The infrastructure of the preview validation: the temporary workspace, the authority that signs test
 * grants, the gateway that stands in for the authenticating proxy of a Workspace administration, the origin
 * that stands in for the CDN, and the browser.
 */
import { createServer, request } from 'node:http';
import { createPrivateKey, sign } from 'node:crypto';
import { cp, mkdtemp, mkdir, realpath, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export { step, results, Fork, Host, Runtime } from '../unified-runtime/harness.mjs';
export { Browser, Origin } from './browser.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const listening = server => new Promise(done => server.listen(0, '127.0.0.1', () => done(`http://127.0.0.1:${server.address().port}`)));

/**
 * A temporary workspace with the fixture packages and the sources of the development runtime
 */
export class Workspace {
	#root;
	get root() {
		return this.#root;
	}

	async create(runtime) {
		this.#root = await realpath(await mkdtemp(join(tmpdir(), 'beyond-preview-')));
		await cp(join(here, 'fixture'), this.#root, { recursive: true });

		const target = join(this.#root, 'runtime');
		await mkdir(target);
		for (const entry of ['package.json', 'bundle', 'main']) await cp(join(runtime.root, entry), join(target, entry), { recursive: true });
		return this;
	}

	file(...parts) {
		return join(this.#root, ...parts);
	}

	destroy() {
		return rm(this.#root, { recursive: true, force: true });
	}
}

/**
 * Signs grants with the public test key of the contract fixtures, as a central administration does with
 * its own, and describes itself to the service as `BEYOND_AUTHORITY` and `BEYOND_ENVIRONMENT`
 */
export class Authority {
	#fixture = name => JSON.parse(readFileSync(join(here, '../../contracts/development/fixtures/grants', `${name}.json`), 'utf8'));
	#keys = this.#fixture('keys');
	#verifier = this.#fixture('vectors').verifier;
	#sequence = 0;

	get environment() {
		const { environment, ...authority } = this.#verifier;
		return { BEYOND_AUTHORITY: JSON.stringify(authority), BEYOND_ENVIRONMENT: environment, BEYOND_TRUST_LOOPBACK: '' };
	}

	grant(capabilities, { subject = 'usr_ana0001', ttl = 900 } = {}) {
		const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
		const iat = Math.floor(Date.now() / 1000);
		const { issuer: iss, environment: aud } = this.#verifier;
		const claims = { iss, aud, sub: subject, prj: 'prj_shop0001', jti: `grt_preview${++this.#sequence}`, iat, exp: iat + ttl, cap: capabilities, act: { kind: 'user' } };

		const signed = `${encode({ alg: 'EdDSA', typ: 'beyond-dev-grant/1', kid: this.#keys.trusted.kid })}.${encode(claims)}`;
		return `${signed}.${sign(null, Buffer.from(signed), createPrivateKey(this.#keys.trusted.private)).toString('base64url')}`;
	}
}

/**
 * Publishes a service under a path prefix and adds the grant of the visitor to every request, which is what
 * the authenticating proxy of a Workspace administration does. The browser never holds the grant.
 */
export class Gateway {
	#server;
	#origin;
	#prefix;

	/**
	 * The requests that reached the service, as `[method, path]`
	 */
	requests = [];

	get base() {
		return `${this.#origin}${this.#prefix}`;
	}

	async start(target, prefix, grant) {
		this.#prefix = prefix;
		const { hostname, port } = new URL(target);

		this.#server = createServer((incoming, outgoing) => {
			if (!incoming.url.startsWith(`${prefix}/`)) return void outgoing.writeHead(404).end();
			const path = incoming.url.slice(prefix.length);
			this.requests.push([incoming.method, path]);

			const headers = { ...incoming.headers, authorization: `Bearer ${grant}` };
			const upstream = request({ hostname, port, path, method: incoming.method, headers }, answer => {
				outgoing.writeHead(answer.statusCode, answer.headers);
				answer.pipe(outgoing);
			});
			upstream.on('error', () => outgoing.destroy());
			outgoing.on('close', () => upstream.destroy());
			incoming.pipe(upstream);
		});
		this.#origin = await listening(this.#server);
		return this;
	}

	stop() {
		this.#server?.closeAllConnections();
		this.#server?.close();
	}
}

/**
 * The messages of an event stream, collected until `close()`
 */
export class Events {
	#controller = new AbortController();
	messages = [];

	async open(url, grant) {
		const response = await fetch(url, { signal: this.#controller.signal, headers: { authorization: `Bearer ${grant}` } });
		if (response.status !== 200) throw new Error(`The event stream answered HTTP ${response.status}`);

		(async () => {
			let buffer = '';
			try {
				for await (const chunk of response.body) {
					buffer += Buffer.from(chunk).toString('utf8');
					for (let end; (end = buffer.indexOf('\n\n')) >= 0; buffer = buffer.slice(end + 2)) {
						const data = /^data: (.*)$/m.exec(buffer.slice(0, end))?.[1];
						data && this.messages.push({ event: /^event: (.*)$/m.exec(buffer.slice(0, end))?.[1], ...JSON.parse(data) });
					}
				}
			} catch {
				// Closed
			}
		})();
		return this;
	}

	async until(match, what, ms = 30000) {
		for (const deadline = Date.now() + ms; Date.now() < deadline; await new Promise(done => setTimeout(done, 50))) {
			const found = this.messages.find(match);
			if (found) return found;
		}
		throw new Error(`Timed out waiting for ${what}`);
	}

	close() {
		this.#controller.abort();
	}
}
