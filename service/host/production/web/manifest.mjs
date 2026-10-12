import { createHash } from 'node:crypto';

/**
 * The manifest of a web export, `beyond-export.json` (`beyond-web-export/1`), written beside the page: what was
 * exported, from what, and how it is identified, so that an export can be inspected, compared with another and
 * replaced. It names no path of the machine that made it.
 *
 * ```json
 * {
 *   "protocol": "beyond-web-export/1", "id": "exp_…", "application": "site", "target": "web",
 *   "strategy": "self-contained", "base": "/", "entry": {"specifier": "@site/web/main", "source": "catalog"},
 *   "files": [{"path": "index.html", "kind": "document", "size": 512, "digest": "sha256-…"}, …],
 *   "sources": [{"name": "@site/web", "version": "1.0.0", "provider": "workspace"}, …],
 *   "cdn": {"origin": "https://cdn.example", "modules": [{"specifier": "react", "url": "…", "integrity": "sha256-…"}]},
 *   "installation": {"state": "ready", "lock": "sha256-…"},
 *   "toolchain": {"packages": "0.0.1", "node": "22.21.1"},
 *   "diagnostics": [], "created": "2026-10-11T12:00:00.000Z"
 * }
 * ```
 *
 * A file's `digest` is the SHA-256 of its bytes as subresource integrity metadata. `sources` lists each package an
 * output came from with where the service read it (`workspace`, `supplied` by the toolchain, `store` of an installed
 * graph, or `installed` in the workspace's directories); `cdn` is present for the `cdn` strategy only.
 */
export class Manifest {
	static PROTOCOL = 'beyond-web-export/1';
	static FILE = 'beyond-export.json';

	/**
	 * The integrity of bytes: `sha256-<base64>`
	 *
	 * @param {string | Buffer} content
	 */
	static digest(content) {
		return `sha256-${createHash('sha256').update(content).digest('base64')}`;
	}

	/**
	 * The packages the outputs came from, by their versioned identity, with their provider
	 *
	 * @param {{module?: string}[]} files
	 * @param {{name: string, version: string | null, source: string}[]} provenance Where the service reads each package
	 */
	static sources(files, provenance) {
		const packages = new Map();
		for (const { module } of files) {
			const found = module && /^(@[^/@]+\/[^/@]+|[^/@]+)@([^/]+)/.exec(module);
			if (!found) continue;
			const [, name, version] = found;
			const known = provenance.find(one => one.name === name && one.version === version);
			packages.set(`${name}@${version}`, { name, version, provider: known?.source ?? 'installed' });
		}
		return [...packages.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.version < b.version ? -1 : 1));
	}

	/**
	 * @param {{id: string, target: object, strategy: string, base: string, files: {file: string, kind: string,
	 * content: string | Buffer, module?: string}[], provenance: object[], cdn?: {origin: string, modules: object[]},
	 * installation?: object, toolchain: object, diagnostics: object[], created: string}} specs
	 */
	static of({ id, target, strategy, base, files, provenance, cdn, installation, toolchain, diagnostics, created }) {
		const listed = files
			.map(({ file, kind, content, module }) => ({ path: file, kind, size: Buffer.byteLength(content), digest: Manifest.digest(content), ...(module ? { module } : {}) }))
			.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
		return {
			protocol: Manifest.PROTOCOL,
			id,
			application: target.application,
			target: target.target,
			strategy,
			base,
			entry: { ...target.entry, source: target.source },
			files: listed,
			sources: Manifest.sources(files, provenance),
			...(cdn ? { cdn } : {}),
			...(installation ? { installation } : {}),
			toolchain,
			diagnostics,
			created
		};
	}
}
