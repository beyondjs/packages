import type { Readable } from 'stream';
import { createReadStream, promises as fs } from 'fs';
import { promises as streams } from 'stream';
import { createGunzip } from 'zlib';
import { createHash } from 'crypto';
import { join } from 'path';
import * as tar from 'tar-stream';

/**
 * One package archive the toolchain carries: its manifest, the `sha512` integrity of its bytes and its file
 */
export interface ISuppliedRelease {
	name: string;
	version: string;
	manifest: Record<string, any>;
	integrity: string;
	file: string;
}

/**
 * The package archives of a toolchain directory (`archives/` of an installation of the command line or of an
 * extracted toolchain bundle), read once: each `.tgz` is hashed and its `package/package.json` read. An archive that
 * cannot be read, or whose manifest names no package and version, is left out and said in `problems`; two archives of
 * one name and version keep the first by file name, and the second is said too.
 */
export class ToolchainCatalog {
	// The largest manifest read from an archive; a larger one is not a package manifest the toolchain packed
	static MANIFEST = 1024 * 1024;

	#directory: string;
	#releases?: Promise<Map<string, Map<string, ISuppliedRelease>>>;
	#problems: string[] = [];

	/**
	 * Why archives were left out, once the catalog was read
	 */
	get problems(): string[] {
		return [...this.#problems];
	}

	get directory(): string {
		return this.#directory;
	}

	constructor(directory: string) {
		this.#directory = directory;
	}

	/**
	 * Every release by name and version
	 */
	releases(): Promise<Map<string, Map<string, ISuppliedRelease>>> {
		this.#releases ??= this.#read();
		return this.#releases;
	}

	/**
	 * The releases of one name, by version; empty when the toolchain carries none
	 */
	async versions(name: string): Promise<Map<string, ISuppliedRelease>> {
		return (await this.releases()).get(name) ?? new Map();
	}

	async release(name: string, version: string): Promise<ISuppliedRelease | undefined> {
		return (await this.versions(name)).get(version);
	}

	async #read(): Promise<Map<string, Map<string, ISuppliedRelease>>> {
		const releases: Map<string, Map<string, ISuppliedRelease>> = new Map();
		let files: string[];
		try {
			files = (await fs.readdir(this.#directory)).filter(file => file.endsWith('.tgz')).sort();
		} catch (error) {
			this.#problems.push(`The toolchain archives cannot be listed (${error?.code || 'unknown error'})`);
			return releases;
		}

		for (const file of files) {
			const release = await this.#archive(join(this.#directory, file)).catch((error: Error) => {
				this.#problems.push(`${file} was left out: ${error.message}`);
				return void 0;
			});
			if (!release) continue;

			const versions = releases.get(release.name) ?? new Map();
			if (versions.has(release.version)) {
				this.#problems.push(`${file} was left out: ${release.name}@${release.version} is already supplied by another archive`);
				continue;
			}
			versions.set(release.version, release);
			releases.set(release.name, versions);
		}
		return releases;
	}

	async #archive(file: string): Promise<ISuppliedRelease> {
		const hash = createHash('sha512');
		let text: string | undefined;

		const extract = tar.extract();
		extract.on('entry', (header, stream, next) => {
			const wanted = header.name.replace(/^\.?\//, '') === 'package/package.json' && header.type === 'file';
			if (!wanted || (header.size ?? 0) > ToolchainCatalog.MANIFEST) {
				stream.on('end', () => next());
				stream.resume();
				return;
			}
			ToolchainCatalog.#text(stream).then(read => ((text = read), next()), next);
		});

		const source = createReadStream(file);
		source.on('data', chunk => hash.update(chunk));
		try {
			await streams.pipeline(source, createGunzip(), extract);
		} catch {
			throw new Error('it is not a readable gzipped tar');
		}

		let manifest: Record<string, any>;
		try {
			manifest = JSON.parse(text ?? '');
		} catch {
			throw new Error('it holds no readable package/package.json');
		}
		const { name, version } = manifest ?? {};
		if (typeof name !== 'string' || !name || typeof version !== 'string' || !version) {
			throw new Error('its manifest names no package and version');
		}
		return { name, version, manifest, integrity: `sha512-${hash.digest('base64')}`, file };
	}

	static async #text(stream: Readable): Promise<string> {
		const chunks: Buffer[] = [];
		for await (const chunk of stream) chunks.push(chunk);
		return Buffer.concat(chunks).toString('utf8');
	}
}
