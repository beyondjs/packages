/**
 * The public declaration of a module, assembled from the declarations of its source files.
 *
 * Each source file becomes an ambient module named after the public module and the file
 * (`declare module "@scope/pkg/mod/~/format"`), so the internal files of a module are addressable by the
 * declaration and by nothing else: they are not public modules, and their names cannot be imported by a
 * consumer that follows the public API. The public module itself re-exports its entry point. Relative
 * imports between the declarations are rewritten to those ambient names; bare imports stay as written,
 * so the public dependencies of the types remain public references that the consumer resolves.
 */
export class Declaration {
	#specifier: string;
	#vspecifier: string;
	#entry: string;
	#parts: Map<string, string> = new Map();

	/**
	 * @param specifier The public specifier of the module
	 * @param vspecifier Its versioned identity, which names the internal ambient modules
	 * @param entry The identity of the entry point, such as `./index`
	 */
	constructor(specifier: string, vspecifier: string, entry: string) {
		this.#specifier = specifier;
		this.#vspecifier = vspecifier;
		this.#entry = entry;
	}

	/**
	 * Adds the emitted declaration of one source file
	 *
	 * @param id The identity of the file, such as `./format`
	 */
	add(id: string, content: string) {
		this.#parts.set(id, content);
	}

	#name(id: string): string {
		return `${this.#vspecifier}/~/${id.replace(/^\.\//, '')}`;
	}

	/**
	 * Resolves a relative specifier of a declaration against the identity of the file that holds it
	 */
	#target(from: string, specifier: string): string {
		const segments = from.replace(/^\.\//, '').split('/');
		segments.pop();
		for (const segment of specifier.split('/')) {
			if (segment === '.' || segment === '') continue;
			segment === '..' ? segments.pop() : segments.push(segment);
		}
		const joined = segments.join('/').replace(/\.(d\.ts|ts|tsx|js)$/, '');
		const id = `./${joined}`;
		if (this.#parts.has(id)) return id;
		if (this.#parts.has(`${id}/index`)) return `${id}/index`;
		return id;
	}

	/**
	 * Rewrites the body of one declaration into the content of its ambient module: `declare` modifiers
	 * are dropped, because everything inside an ambient module is ambient, and relative specifiers are
	 * rewritten to the ambient names
	 */
	#body(id: string, content: string): string {
		const references: string[] = [];
		const lines = content.split('\n').filter(line => {
			const reference = /^\/\/\/\s*<reference\s/.test(line);
			reference && references.push(line);
			return !reference;
		});

		const rewritten = lines
			.map(line => line.replace(/^(export\s+)?declare\s+/, '$1'))
			.join('\n')
			.replace(/(\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)(["'])(\.\.?\/[^"']+)\2/gm, (match, prefix, quote, specifier) => `${prefix}${quote}${this.#name(this.#target(id, specifier))}${quote}`);

		return [...references, rewritten].join('\n');
	}

	/**
	 * Where the ambient module of a public specifier is in a declaration that `code` wrote: the last block,
	 * whose body re-exports the entry point of the module
	 */
	static #block(code: string, specifier: string): { start: number; body: string } | undefined {
		const header = `declare module "${specifier}" {\n`;
		const start = code.lastIndexOf(header);
		const end = start < 0 ? -1 : code.indexOf('\n}', start + header.length);
		if (end < 0) return;
		return { start, body: code.slice(start + header.length, end) };
	}

	/**
	 * A declaration without the ambient module of its public specifier: its internal modules, which its
	 * versioned identity names, for a program where another instance of the package declares that specifier
	 */
	static internal(code: string, specifier: string): string {
		const block = Declaration.#block(code, specifier);
		return block ? `${code.slice(0, block.start).trimEnd()}\n` : code;
	}

	/**
	 * An ambient module named after an alias of a public module, with the exports of its declaration: what a
	 * package that imports a member under another name (`"alias": "workspace:…"`) is typed with
	 *
	 * @param code The declaration of the public module
	 * @param specifier The public specifier it declares
	 * @param alias The specifier as the importer writes it
	 */
	static alias(code: string, specifier: string, alias: string): string {
		const body = Declaration.#block(code, specifier)?.body ?? `\texport * from "${specifier}";`;
		return `declare module "${alias}" {\n${body}\n}\n`;
	}

	/**
	 * The declaration file of the public module
	 */
	get code(): string {
		const parts = [...this.#parts.keys()].sort().map(id => {
			const body = this.#body(id, this.#parts.get(id)).trim();
			return `declare module "${this.#name(id)}" {\n${body.split('\n').map(line => (line ? `\t${line}` : line)).join('\n')}\n}`;
		});

		const entry = this.#parts.get(this.#entry) ?? '';
		const exports = [`export * from "${this.#name(this.#entry)}";`];
		/export\s+default\b/.test(entry) && exports.push(`export { default } from "${this.#name(this.#entry)}";`);
		parts.push(`declare module "${this.#specifier}" {\n${exports.map(line => `\t${line}`).join('\n')}\n}`);

		return `${parts.join('\n\n')}\n`;
	}
}
