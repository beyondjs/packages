import type { Readable } from 'stream';
import type { IStoreStage } from './types';
import type { Limits } from './limits';
import type { Integrity } from './integrity';
import { Transform, promises } from 'stream';
import { createGunzip } from 'zlib';
import { createHash } from 'crypto';
import * as tar from 'tar-stream';
import { Entry } from './entry';
import { Refusal } from './refusal';

export interface IArchiveOutcome {
	// The integrity computed over the compressed bytes, when none was published to verify against
	integrity?: string;
	bytes: number;
	extracted: number;
	entries: number;
	files: Record<string, number>;
}

/**
 * Reads a gzipped package archive once, as it arrives: the compressed bytes are hashed and counted, and
 * the entries are validated, counted and written to a stage. Every bound is enforced while streaming, so
 * an abusive archive is abandoned as soon as it exceeds one, not after it was stored.
 *
 * The integrity is verified over the compressed bytes when the stream ends. The caller publishes the
 * stage only after `extract` resolves; on any refusal it discards it.
 */
export class Archive {
	#limits: Limits;
	#integrity: Integrity;
	#established: boolean;

	/**
	 * @param established True when no integrity was published: the archive is hashed with sha512 and the
	 *   digest is returned instead of verified
	 */
	constructor(limits: Limits, integrity: Integrity, established = false) {
		this.#limits = limits;
		this.#integrity = integrity;
		this.#established = established;
	}

	async extract(body: Readable, stage: IStoreStage): Promise<IArchiveOutcome> {
		const limits = this.#limits;
		const hash = this.#established ? createHash('sha512') : this.#integrity.hash();
		const outcome: IArchiveOutcome = { bytes: 0, extracted: 0, entries: 0, files: {} };

		const meter = new Transform({
			transform(chunk: Buffer, encoding, done) {
				outcome.bytes += chunk.length;
				if (outcome.bytes > limits.compressed) {
					const message = `The archive exceeds the limit of ${limits.compressed} compressed bytes`;
					return done(new Refusal('ARCHIVE_TOO_LARGE', message));
				}
				hash.update(chunk);
				done(null, chunk);
			}
		});

		const extract = tar.extract();
		extract.on('entry', (header, stream, next) => {
			// A refusal destroys the extraction, which fails every entry stream still open: the
			// refusal is already reported through the pipeline
			stream.on('error', (): void => {});

			this.#entry(header, stream, stage, outcome).then(
				() => next(),
				error => {
					stream.resume();
					next(error);
				}
			);
		});

		try {
			await promises.pipeline(body, meter, createGunzip(), extract);
		} catch (error) {
			if (error instanceof Refusal) throw error;

			// A decoder failure means the bytes are not the archive that was published; anything else
			// is the transfer failing
			const decoder = typeof error?.code === 'string' && error.code.startsWith('Z_');
			const format = /tar|header|unexpected end/i.test(error?.message || '');
			if (decoder || format) {
				throw new Refusal('ARCHIVE_CORRUPT', 'The archive could not be decoded as a gzipped tar');
			}
			throw new Refusal('DOWNLOAD_FAILED', 'The transfer of the archive was interrupted');
		}

		if (this.#established) {
			outcome.integrity = `sha512-${hash.digest('base64')}`;
			return outcome;
		}

		if (!this.#integrity.matches(hash)) {
			const message = `The archive does not match the published ${this.#integrity.algorithm} integrity`;
			throw new Refusal('INTEGRITY_MISMATCH', message);
		}
		return outcome;
	}

	async #entry(header: tar.Headers, stream: Readable, stage: IStoreStage, outcome: IArchiveOutcome): Promise<void> {
		const limits = this.#limits;

		outcome.entries++;
		if (outcome.entries > limits.entries) {
			throw new Refusal('ENTRIES_LIMIT', `The archive has more than ${limits.entries} entries`);
		}

		const path = Entry.path(header);
		if (!path) {
			stream.resume();
			return;
		}

		// The declared size is known before the content is inflated: refuse without reading it
		const oversize = () =>
			new Refusal('EXTRACTED_TOO_LARGE', `The archive extracts to more than ${limits.extracted} bytes`);
		if (outcome.extracted + (header.size || 0) > limits.extracted) throw oversize();

		const written = await stage.write(path, stream);
		outcome.extracted += written;
		if (outcome.extracted > limits.extracted) throw oversize();
		outcome.files[path] = written;
	}
}
