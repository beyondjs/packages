/**
 * A git host for tests that answers the three endpoints a resolution and a fetch use, in the layout of GitLab:
 * the smart-HTTP reference advertisement (`/<owner>/<repo>.git/info/refs?service=git-upload-pack`), the raw
 * `package.json` of a commit (`/<owner>/<repo>/-/raw/<commit>/package.json`) and the gzipped archive of a
 * commit (`/<owner>/<repo>/-/archive/<commit>/<repo>-<commit>.tar.gz`). Nothing is cloned: the repository is
 * data. Every request is recorded by type.
 */
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { archive } from './registry.mjs';

/**
 * One pkt-line of the smart-HTTP protocol: four hexadecimal digits of length, including themselves
 */
const line = text => `${(Buffer.byteLength(text) + 4).toString(16).padStart(4, '0')}${text}`;

/**
 * A commit hash made from a label, so the fixtures read as names
 */
export const commit = label => createHash('sha1').update(label).digest('hex');

export class Forge {
	#server;
	#repositories = new Map();

	requests = { refs: 0, manifest: 0, archive: 0, other: 0 };
	log = [];

	get host() {
		return `127.0.0.1:${this.#server.address().port}`;
	}

	/**
	 * Declares a repository
	 *
	 * @param {string} path `<owner>/<repo>`
	 * @param {{commits: Record<string, {manifest: object, files?: Record<string, string>}>, branches?: Record<string, string>, tags?: Record<string, string>, annotated?: Record<string, string>, head?: string}} data
	 * Commits by hash; branches and lightweight tags name a commit; an annotated tag names the commit it points
	 * to through a tag object of its own
	 */
	repository(path, data) {
		this.#repositories.set(path, { branches: {}, tags: {}, annotated: {}, ...data });
		return this;
	}

	reset() {
		this.requests = { refs: 0, manifest: 0, archive: 0, other: 0 };
		this.log = [];
	}

	#advertisement({ branches, tags, annotated, head }) {
		const references = [];
		const main = head || Object.keys(branches)[0];
		if (main) references.push([branches[main], 'HEAD']);
		for (const [name, target] of Object.entries(branches)) references.push([target, `refs/heads/${name}`]);
		for (const [name, target] of Object.entries(tags)) references.push([target, `refs/tags/${name}`]);
		for (const [name, target] of Object.entries(annotated)) {
			references.push([commit(`tag object ${name}`), `refs/tags/${name}`], [target, `refs/tags/${name}^{}`]);
		}

		const lines = references.map(([hash, name], index) => line(`${hash} ${name}${index ? '' : '\0multi_ack side-band-64k agent=forge/1'}\n`));
		return `${line('# service=git-upload-pack\n')}0000${lines.join('')}0000`;
	}

	async #handle(request, response) {
		const url = new URL(request.url, 'http://forge');
		const send = (status, body, type = 'application/json') => {
			response.writeHead(status, { 'content-type': type });
			response.end(body);
		};
		const record = type => {
			this.requests[type]++;
			this.log.push({ type, path: url.pathname, credential: !!request.headers.authorization });
		};

		const refs = /^\/([^/]+\/[^/]+)\.git\/info\/refs$/.exec(url.pathname);
		const raw = /^\/([^/]+\/[^/]+)\/-\/raw\/([0-9a-f]{40})\/package\.json$/.exec(url.pathname);
		const tarball = /^\/([^/]+\/[^/]+)\/-\/archive\/([0-9a-f]{40})\/[^/]+\.tar\.gz$/.exec(url.pathname);
		record(refs ? 'refs' : raw ? 'manifest' : tarball ? 'archive' : 'other');

		const repository = this.#repositories.get((refs || raw || tarball)?.[1]);
		if (!repository) return send(404, '{}');

		if (refs) {
			if (url.searchParams.get('service') !== 'git-upload-pack') return send(403, '{}');
			return send(200, this.#advertisement(repository), 'application/x-git-upload-pack-advertisement');
		}

		const found = repository.commits[(raw || tarball)[2]];
		if (!found) return send(404, '{}');
		if (raw) return send(200, JSON.stringify(found.manifest));

		const root = `${(raw || tarball)[1].split('/')[1]}-${tarball[2]}`;
		const files = { 'package.json': JSON.stringify(found.manifest), ...(found.files || { 'index.js': 'module.exports = 1;' }) };
		const bytes = await archive(Object.entries(files).map(([name, content]) => ({ name: `${root}/${name}`, content })));
		send(200, bytes, 'application/gzip');
	}

	async start() {
		this.#server = createServer((request, response) => this.#handle(request, response));
		await new Promise(resolve => this.#server.listen(0, '127.0.0.1', resolve));
		return this;
	}

	async stop() {
		this.#server.closeAllConnections?.();
		await new Promise(resolve => this.#server.close(resolve));
	}
}
