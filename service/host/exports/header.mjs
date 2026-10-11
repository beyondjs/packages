/**
 * The blocks that announce one entry of a reproducible tar archive: POSIX ustar, with a pax extended header before
 * it when its path does not fit the 100 bytes of the name field.
 *
 * Nothing that depends on the machine or the moment is written: the modification time is 0, the owner and the group
 * are 0 and unnamed, a file is `0644` or `0755` (executable for its owner) and a directory `0755`. Equal paths and
 * contents therefore give equal bytes, which is the layout of Conduict's capture archive.
 *
 * ```js
 * const blocks = Header.of('src/index.ts', 120, 0o644, '0');   // [Buffer] or [pax header, pax body, Buffer]
 * ```
 */
export class Header {
	static BLOCK = 512;

	static #field(block, offset, length, value) {
		block.write(value, offset, Math.min(length, Buffer.byteLength(value)), 'utf8');
	}

	static #octal(block, offset, length, value) {
		Header.#field(block, offset, length, `${value.toString(8).padStart(length - 1, '0')}\0`);
	}

	static #block(name, size, mode, type) {
		const block = Buffer.alloc(Header.BLOCK);
		Header.#field(block, 0, 100, name);
		Header.#octal(block, 100, 8, mode);
		Header.#octal(block, 108, 8, 0);
		Header.#octal(block, 116, 8, 0);
		Header.#octal(block, 124, 12, size);
		Header.#octal(block, 136, 12, 0);
		block.fill(' ', 148, 156);
		Header.#field(block, 156, 1, type);
		Header.#field(block, 257, 6, 'ustar\0');
		Header.#field(block, 263, 2, '00');
		let sum = 0;
		for (const byte of block) sum += byte;
		Header.#field(block, 148, 8, `${sum.toString(8).padStart(6, '0')}\0 `);
		return block;
	}

	/**
	 * Bytes padded with zeros to a whole number of blocks
	 *
	 * @param {Buffer} bytes
	 */
	static pad(bytes) {
		const rest = bytes.length % Header.BLOCK;
		return rest ? Buffer.concat([bytes, Buffer.alloc(Header.BLOCK - rest)]) : bytes;
	}

	/**
	 * The blocks that announce one entry
	 *
	 * @param {string} path Relative, with `/`; a directory ends with `/`
	 * @param {number} size The bytes of its content (0 for a directory)
	 * @param {number} mode
	 * @param {'0' | '5'} type A file or a directory
	 * @returns {Buffer[]}
	 */
	static of(path, size, mode, type) {
		if (Buffer.byteLength(path) <= 100) return [Header.#block(path, size, mode, type)];

		// A pax record counts its own length, digits included
		const tail = ` path=${path}\n`;
		let length = Buffer.byteLength(tail) + 1;
		while (Buffer.byteLength(`${length}${tail}`) !== length) length = Buffer.byteLength(`${length}${tail}`);
		const body = Buffer.from(`${length}${tail}`);
		const short = `PaxHeaders/${Buffer.from(path).subarray(-80).toString('utf8').replace(/^[^/]*\//, '')}`;
		return [Header.#block(short.slice(0, 99), body.length, 0o644, 'x'), Header.pad(body), Header.#block(short.slice(0, 99), size, mode, type)];
	}
}
