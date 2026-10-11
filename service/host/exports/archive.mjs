import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { lstat, readdir, rename, rm } from 'node:fs/promises';
import { once } from 'node:events';
import { join } from 'node:path';
import { Entry } from './entry.mjs';
import { ExportError } from './error.mjs';
import { Header } from './header.mjs';
import { Listing } from './listing.mjs';
import { Publication } from './publication.mjs';
import { Rules } from './rules.mjs';

/**
 * The archive of one package as it is on disk now, uncommitted work included: a reproducible tar (`Header`) of the
 * files its registry publication would hold (`Publication`), written to a file and hashed while it is written.
 *
 * Entries are walked depth first with the entries of each directory sorted by name, so equal files give equal bytes
 * and an equal SHA-256; a directory is written only when it holds a file of the archive. Left out, and listed by
 * reason (`Listing`): what `Rules` always leaves out (`internal`, `secrets`), symbolic links (`links`), the
 * directories of other workspace packages inside this one (`members`) and what the publication would not hold
 * (`ignored`). A file is opened without following a link and must be the entry that was walked (its device and inode),
 * and a directory must stay the one that was listed, or the export fails (`EXPORT_CHANGED`) rather than archiving
 * something else. Past `Archive.FILES` files or `Archive.BYTES` bytes of archive it fails (`EXPORT_TOO_LARGE`) rather
 * than being cut.
 *
 * ```js
 * const archive = new Archive(directory, { manifest, members: [nested] });
 * const { digest, bytes, files, excluded } = await archive.write(file);
 * ```
 */
export class Archive {
	/**
	 * The largest archive, in bytes: Snapshots' and CDN's limit for one archive (50 MiB), so whatever is exported
	 * can be captured and prepared. An engineering default.
	 */
	static BYTES = 50 * 1048576;

	/**
	 * The most files of one archive. An engineering default.
	 */
	static FILES = 10000;

	/**
	 * The most entries walked in one package, archived or not, so a walk of a huge tree ends
	 */
	static ENTRIES = 200000;

	#directory;
	#members;
	#limits;
	#publication;
	#listing = new Listing();
	#pending = [];
	#stream;
	#hash = createHash('sha256');
	#bytes = 0;
	#files = 0;
	#visited = 0;

	/**
	 * @param {string} directory The canonical directory of the package
	 * @param {{manifest?: object, members?: string[], bytes?: number, files?: number}} [options] Its manifest, the
	 * canonical directories of the other workspace packages inside it, and the bounds
	 */
	constructor(directory, { manifest, members = [], bytes = Archive.BYTES, files = Archive.FILES } = {}) {
		this.#directory = directory;
		this.#members = new Set(members);
		this.#limits = { bytes, files };
		this.#publication = new Publication(directory, manifest);
	}

	async #emit(blocks) {
		for (const block of blocks) {
			this.#hash.update(block);
			if (!this.#stream.write(block)) await once(this.#stream, 'drain');
		}
	}

	/**
	 * Counts what an entry adds to the archive, and refuses it past the bounds; the two closing blocks are counted
	 * from the start, so an archive never ends past them
	 */
	#count(blocks, file) {
		const size = blocks.reduce((total, block) => total + block.length, 0);
		if (file && ++this.#files > this.#limits.files) {
			throw new ExportError('EXPORT_TOO_LARGE', `A package is exported with at most ${this.#limits.files} files`);
		}
		if ((this.#bytes += size) + 2 * Header.BLOCK > this.#limits.bytes) {
			throw new ExportError('EXPORT_TOO_LARGE', `The archive of a package is at most ${this.#limits.bytes} bytes`);
		}
	}

	/**
	 * Writes an entry, after the directories that hold it and were not written yet
	 */
	async #write(blocks, file) {
		for (const directory of this.#pending.splice(0)) {
			const header = Header.of(directory, 0, 0o755, '5');
			this.#count(header, false);
			await this.#emit(header);
		}
		this.#count(blocks, file);
		await this.#emit(blocks);
	}

	static #order(a, b) {
		return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
	}

	async #walk(absolute, relative, inherited) {
		const before = await lstat(absolute);
		if (!before.isDirectory()) throw Entry.changed(relative || '.');
		const own = await this.#publication.rules(relative);
		const rules = own ? [...inherited, own] : inherited;
		const entries = (await readdir(absolute, { withFileTypes: true })).sort(Archive.#order);
		const after = await lstat(absolute);
		if (after.dev !== before.dev || after.ino !== before.ino) throw Entry.changed(relative || '.');
		const parent = relative.split('/').at(-1) ?? '';

		for (const entry of entries) {
			if (++this.#visited > Archive.ENTRIES) throw new ExportError('EXPORT_TOO_LARGE', `A package is walked through at most ${Archive.ENTRIES} entries`);
			const path = relative ? `${relative}/${entry.name}` : entry.name;
			const child = join(absolute, entry.name);
			if (entry.isSymbolicLink()) {
				this.#listing.exclude('links', path);
				continue;
			}

			if (entry.isDirectory()) {
				const reason = Rules.directory(entry.name);
				if (reason) this.#listing.exclude(reason === 'secret' ? 'secrets' : 'internal', `${path}/`);
				else if (this.#members.has(child)) this.#listing.exclude('members', `${path}/`);
				else if (!this.#publication.includes(path, true, rules)) this.#listing.exclude('ignored', `${path}/`);
				else {
					this.#pending.push(`${path}/`);
					await this.#walk(child, path, rules);
					if (this.#pending.at(-1) === `${path}/`) this.#pending.pop();
				}
				continue;
			}

			if (!entry.isFile()) continue;
			if (Rules.secret(entry.name, parent)) this.#listing.exclude('secrets', path);
			else if (!this.#publication.includes(path, false, rules)) this.#listing.exclude('ignored', path);
			else {
				const walked = await lstat(child);
				if (walked.size > this.#limits.bytes) throw new ExportError('EXPORT_TOO_LARGE', `"${path}" is larger than the archive of a package may be (${this.#limits.bytes} bytes)`);
				const bytes = await Entry.read(child, walked, path);
				await this.#write([...Header.of(path, bytes.length, walked.mode & 0o111 ? 0o755 : 0o644, '0'), Header.pad(bytes)], true);
				this.#listing.include(path);
			}
		}
	}

	/**
	 * Writes the archive to a file, through a temporary one beside it that is renamed once complete
	 *
	 * @param {string} file
	 * @returns {Promise<{digest: string, bytes: number, files: string[], excluded: object, omitted?: object}>} The
	 * SHA-256 of the archive in hexadecimal, its size, the files it holds and what it left out by reason
	 * @throws {ExportError} `EXPORT_TOO_LARGE` or `EXPORT_CHANGED`, and nothing is left on disk
	 */
	async write(file) {
		const temporary = `${file}.${process.pid}.tmp`;
		this.#stream = createWriteStream(temporary, { mode: 0o600 });
		const failed = new Promise((resolve, reject) => this.#stream.once('error', reject));
		failed.catch(() => void 0);

		try {
			await Promise.race([this.#walk(this.#directory, '', []), failed]);
			await this.#emit([Buffer.alloc(2 * Header.BLOCK)]);
			this.#stream.end();
			await Promise.race([once(this.#stream, 'close'), failed]);
			await rename(temporary, file);
		} catch (error) {
			this.#stream.destroy();
			await rm(temporary, { force: true });
			throw error;
		}
		return { digest: this.#hash.digest('hex'), bytes: this.#bytes + 2 * Header.BLOCK, ...this.#listing.toJSON() };
	}
}
