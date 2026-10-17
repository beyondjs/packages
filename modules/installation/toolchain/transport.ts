import type { SourcesTransport } from '@beyond-js/packages/sources';
import type { ToolchainCatalog } from './catalog';
import { createReadStream, promises as fs } from 'fs';
import { Readable } from 'stream';
import { ToolchainAddress } from './address';

/**
 * The transport of an installation's fetch with the toolchain's archives: an archive address of the toolchain
 * (`toolchain:<name>@<version>`) is answered with the bytes of the archive that carries that release, and every other
 * request goes on to the next transport. The integrity the lock records is verified by the fetch as for any archive,
 * so an archive replaced since the lock was written is refused, never trusted.
 */
export class ToolchainTransport {
	#catalog: ToolchainCatalog;
	#next: SourcesTransport;

	constructor(catalog: ToolchainCatalog, next: SourcesTransport) {
		this.#catalog = catalog;
		this.#next = next;
	}

	get transport(): SourcesTransport {
		return (url: string, init?: RequestInit) => this.#request(url, init);
	}

	async #request(url: string, init?: RequestInit): Promise<Response> {
		const address = ToolchainAddress.parse(url);
		if (!address) return await this.#next(url, init);

		const release = await this.#catalog.release(address.name, address.version);
		if (!release) {
			const missing = `${address.name}@${address.version} is not among the archives of this toolchain`;
			throw Object.assign(new Error(missing), { code: 'TOOLCHAIN_ARCHIVE_MISSING' });
		}

		const { size } = await fs.stat(release.file);
		const body = <ReadableStream>Readable.toWeb(createReadStream(release.file, { signal: init?.signal }));
		return new Response(body, { status: 200, headers: { 'content-length': String(size) } });
	}
}
