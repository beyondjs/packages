import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer as plain } from 'node:http';
import { createServer as secure } from 'node:https';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PAGE = readFileSync(fileURLToPath(new URL('../fixtures/pages/probe.html', import.meta.url)), 'utf8');

/**
 * The pages of the browser probe: the interface origins it pairs from, and one it must not read anything from.
 *
 * - An HTTPS origin, `https://localhost:<port>`, with a self-signed certificate made for the run with `openssl`, which
 *   the browsers are told to accept: the shape of a hosted Packages interface reaching a service on this machine.
 *   The same server is also `https://127.0.0.1:<port>`, another origin, which is not allowed: a page of another site.
 * - A plain HTTP origin on a name that is not a loopback one: this machine's first non-internal IPv4 address, when it
 *   has one.
 * - A plain HTTP page of another site on this machine, `http://localhost:<port>` (`localhost` is another site than
 *   `127.0.0.1`, where the service listens), which loads nothing of it: plain, so no engine blocks its requests as mixed
 *   content and what it is refused is the service's refusal.
 *
 * ```js
 * const pages = await new Pages().start();
 * pages.https; pages.foreign; pages.http; pages.elsewhere;   // origins (http is undefined without a non-loopback address)
 * await pages.stop();
 * ```
 */
export class Pages {
	#directory = mkdtempSync(join(tmpdir(), 'beyond probe pages '));
	#servers = [];
	#https;
	#http;
	#elsewhere;

	get https() {
		return this.#https && `https://localhost:${this.#https}`;
	}

	get foreign() {
		return this.#https && `https://127.0.0.1:${this.#https}`;
	}

	get http() {
		return this.#http;
	}

	get elsewhere() {
		return this.#elsewhere && `http://localhost:${this.#elsewhere}`;
	}

	/**
	 * The first IPv4 address of this machine that is not a loopback one
	 */
	static address() {
		for (const addresses of Object.values(networkInterfaces())) {
			const found = addresses?.find(({ family, internal }) => (family === 'IPv4' || family === 4) && !internal);
			if (found) return found.address;
		}
	}

	static #answer(request, response) {
		response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
		response.end(PAGE);
	}

	static #listen(server, host) {
		return new Promise((resolve, reject) => {
			server.once('error', reject);
			server.listen(0, host, () => resolve(server.address().port));
		});
	}

	async start() {
		const key = join(this.#directory, 'key.pem');
		const certificate = join(this.#directory, 'certificate.pem');
		execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', certificate, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' });
		const https = secure({ key: readFileSync(key), cert: readFileSync(certificate) }, Pages.#answer);
		this.#servers.push(https);
		this.#https = await Pages.#listen(https, '127.0.0.1');
		const elsewhere = plain(Pages.#answer);
		this.#servers.push(elsewhere);
		this.#elsewhere = await Pages.#listen(elsewhere, '127.0.0.1');

		const address = Pages.address();
		if (address) {
			const http = plain(Pages.#answer);
			this.#servers.push(http);
			this.#http = `http://${address}:${await Pages.#listen(http, address)}`;
		}
		return this;
	}

	async stop() {
		for (const server of this.#servers) {
			server.closeAllConnections?.();
			await new Promise(resolve => server.close(resolve));
		}
		rmSync(this.#directory, { recursive: true, force: true });
	}
}
