import { createHash } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { gzip, constants } from 'node:zlib';
import { Archive } from '../../exports/archive.mjs';
import { Header } from '../../exports/header.mjs';

const compress = promisify(gzip);

/**
 * The registry archive of a package (`npm pack`'s format): a gzipped tar whose entries are the package's files under
 * `package/`, made from the same file set and with the same reproducible headers as its source export, so that a
 * capture and a publication of the same sources hold the same files.
 *
 * The file set is decided by the source export's [Archive](../../exports/archive.mjs), never copied: the files its
 * registry publication would hold (`files`, `.npmignore`/`.gitignore`), never dependencies, internals, links, other
 * members or secrets. That archive is written first beside the result and read back; each file it holds becomes an
 * entry `package/<path>` with its mode (`0644`, `0755`), modification time, owner and group 0, in the archive's
 * order, without directory entries, as npm writes them. No package script runs. The tar is compressed at level 9 and
 * the operating-system byte of the gzip header is fixed (`255`, unknown), so equal sources give equal bytes with the
 * same Node, whatever the machine.
 *
 * ```js
 * const { size, integrity, shasum, files } = await new Tarball(directory, { manifest, members }).write(file);
 * ```
 */
export class Tarball {
	static PREFIX = 'package/';

	#directory;
	#options;

	/**
	 * @param {string} directory The canonical directory of the package
	 * @param {{manifest: object, members?: string[], bytes?: number, files?: number}} options Its manifest, the
	 * directories of the other members inside it, and the bounds of its source archive
	 */
	constructor(directory, options) {
		this.#directory = directory;
		this.#options = options;
	}

	/**
	 * Writes the archive through a temporary file beside it, renamed once complete
	 *
	 * @param {string} file
	 * @returns {Promise<{size: number, integrity: string, shasum: string, files: string[], excluded: object, omitted?: object}>}
	 * The size of the archive in bytes, its `sha512-<base64>` integrity and its `sha1` hexadecimal shasum as npm records
	 * them, the files it holds (relative to the package) and what it left out by reason
	 * @throws {import('../../exports/error.mjs').ExportError} `EXPORT_TOO_LARGE` or `EXPORT_CHANGED`
	 */
	async write(file) {
		const source = `${file}.${process.pid}.tar`;
		const temporary = `${file}.${process.pid}.tmp`;
		try {
			const listing = await new Archive(this.#directory, this.#options).write(source);
			const tar = Tarball.#prefixed(await readFile(source));
			const compressed = await compress(tar, { level: constants.Z_BEST_COMPRESSION });
			compressed[9] = 255;
			await writeFile(temporary, compressed, { mode: 0o600 });
			await rename(temporary, file);
			const { files, excluded, omitted } = listing;
			return { size: compressed.length, ...Tarball.digests(compressed), files, excluded, ...(omitted ? { omitted } : {}) };
		} finally {
			await rm(source, { force: true });
			await rm(temporary, { force: true });
		}
	}

	/**
	 * The integrity and the shasum of an archive's bytes, as a registry records them
	 *
	 * @param {Buffer} bytes
	 */
	static digests(bytes) {
		return {
			integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
			shasum: createHash('sha1').update(bytes).digest('hex')
		};
	}

	/**
	 * The entries of a tar written by `Header`, as `{path, mode, type, content}`: a pax `path` record names the entry
	 * that follows it
	 *
	 * @param {Buffer} bytes
	 */
	static *entries(bytes) {
		const field = (block, offset, length) => block.subarray(offset, offset + length).toString('utf8').replace(/\0.*$/s, '');
		const octal = (block, offset, length) => parseInt(field(block, offset, length).trim() || '0', 8);
		let pending;
		for (let offset = 0; offset + Header.BLOCK <= bytes.length; ) {
			const block = bytes.subarray(offset, offset + Header.BLOCK);
			if (block.every(byte => byte === 0)) return;
			const size = octal(block, 124, 12);
			const type = field(block, 156, 1);
			const content = bytes.subarray(offset + Header.BLOCK, offset + Header.BLOCK + size);
			offset += Header.BLOCK + Math.ceil(size / Header.BLOCK) * Header.BLOCK;
			if (type === 'x') {
				pending = /\d+ path=(.*)\n/s.exec(content.toString('utf8'))?.[1];
				continue;
			}
			yield { path: pending ?? field(block, 0, 100), mode: octal(block, 100, 8), type, content };
			pending = void 0;
		}
	}

	/**
	 * The source archive's files under `package/`, without its directory entries, ended by two zero blocks
	 */
	static #prefixed(bytes) {
		const blocks = [];
		for (const { path, mode, type, content } of Tarball.entries(bytes)) {
			if (type !== '0') continue;
			blocks.push(...Header.of(`${Tarball.PREFIX}${path}`, content.length, mode, '0'), Header.pad(Buffer.from(content)));
		}
		blocks.push(Buffer.alloc(2 * Header.BLOCK));
		return Buffer.concat(blocks);
	}
}
