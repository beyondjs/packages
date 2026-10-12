import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import { isAbsolute, relative, sep } from 'path';
import { DevelopmentError } from '../error';

/**
 * Reads a file of a package for type browsing, and nothing outside it: the real path of the file, symbolic links
 * followed, must be inside the real directory of the package (`403 TYPES_ACCESS` otherwise), it is read within a
 * bound (`422 TYPES_UNSUPPORTED` past it) and it must be UTF-8 text (`422 DECLARATION_INVALID` otherwise). The text
 * is answered as it is: nothing is synthesized or completed.
 */
export class Confined {
	/**
	 * The largest file that is read, in bytes
	 */
	static LIMIT = 1024 * 1024;

	#root: string;

	/**
	 * @param root The real directory of the package
	 */
	constructor(root: string) {
		this.#root = root;
	}

	/**
	 * The path of a file relative to the package, with `/`, or undefined when it is not inside
	 */
	#path(file: string): string | undefined {
		const named = relative(this.#root, file);
		if (!named || named.startsWith('..') || isAbsolute(named)) return;
		return named.split(sep).join('/');
	}

	/**
	 * @param file The file, as the package names it
	 * @param label Who names it, for the messages
	 * @returns The text, its digest (`sha256-<hex>`) and its path relative to the package
	 * @throws DevelopmentError `TYPES_ACCESS`, `TYPES_UNSUPPORTED`, `DECLARATION_INVALID`
	 */
	async read(file: string, label: string): Promise<{ text: string; etag: string; path: string }> {
		const path = this.#path(file);
		const real = path && (await fs.realpath(file).catch((): undefined => void 0));
		if (!path || !real || !this.#path(real)) {
			const named = path ? `"${path}", whose real location is` : 'a file';
			const message = `${label} names ${named} outside the package: only files inside the package are read`;
			throw new DevelopmentError('TYPES_ACCESS', message, 403);
		}

		const { size } = await fs.stat(real);
		const large = () => new DevelopmentError('TYPES_UNSUPPORTED', `${label}: "${path}" is larger than ${Confined.LIMIT} bytes, the most this route reads`, 422, { size, limit: Confined.LIMIT });
		if (size > Confined.LIMIT) throw large();
		const bytes = await fs.readFile(real);
		if (bytes.length > Confined.LIMIT) throw large();

		let text: string;
		try {
			if (bytes.includes(0)) throw new Error('NUL');
			text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
		} catch {
			throw new DevelopmentError('DECLARATION_INVALID', `${label}: "${path}" is not UTF-8 text`, 422);
		}
		return { text, etag: `sha256-${createHash('sha256').update(bytes).digest('hex')}`, path };
	}
}
