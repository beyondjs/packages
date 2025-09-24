import { PackageIdentifier } from '@beyond-js/packages/package/identifier';
import { createGunzip } from 'zlib';
import * as stream from 'stream';
import * as tar from 'tar-stream';
import { File } from '@beyond-js/packages/persistence/storage';
import { Providers } from '@beyond-js/packages/providers';

const { pipeline } = stream.promises;
const ROOT = 'packages';

/**
 * Downloads and extracts a tarball into the appropriate storage backend.
 */
export /*bundle*/ class TarballDownloader {
	readonly #providers: Providers;

	readonly #identifier: PackageIdentifier;
	get identifier() {
		return this.#identifier;
	}

	readonly #url: string;
	get url(): string {
		return this.#url;
	}

	/**
	 * @param identifier - The package identifier object containing its path
	 * @param url - The URL to the .tar.gz file to download.
	 */
	constructor(providers: Providers, identifier: PackageIdentifier, url: string) {
		this.#providers = providers;
		this.#identifier = identifier;
		this.#url = url;
	}

	/**
	 * Downloads the tarball and extracts its content to file storage.
	 */
	async download(): Promise<void> {
		// Download tarball as stream
		const response = await fetch(this.#url);
		if (!response.ok || !response.body) {
			throw new Error(`Failed to fetch tarball from ${this.#url}: ${response.statusText}`);
		}

		const extract = tar.extract();
		extract.on('entry', async (header, entryStream, next) => {
			if (header.type !== 'file') {
				entryStream.resume(); // skip directories and others
				return next();
			}

			const path = header.name.replace(/^package\//, '');
			const target = `${this.#identifier.path}/${path}`;
			const file = new File(ROOT, target);

			const writeStream = await file.stream();
			await pipeline(entryStream, writeStream);
			next();
		});

		const gunzip = createGunzip();
		await pipeline(response.body, gunzip, extract);
	}
}
