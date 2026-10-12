import { builtinModules } from 'module';

/**
 * A bare specifier a declaration imports, with the importer that resolves it as the type check does: what a client
 * sends back as `GET /types?specifier=&importer=` to follow it
 */
export interface ITypesReference {
	specifier: string;
	importer: string;
}

/**
 * The public specifiers a declaration imports: `from "…"`, `import "…"`, `import("…")`, `require("…")` and
 * `/// <reference types="…" />`, in the order the text names them, once each. Comments are left out, strings are
 * not. Relative specifiers, Node builtins, addresses with a scheme and the names the caller excludes (the internal
 * modules of a consolidated declaration, the module itself) are not references.
 */
export class References {
	/**
	 * The most references a declaration gives
	 */
	static LIMIT = 200;

	static #PATTERNS = [
		/\bfrom\s*(["'])([^"'\n]+)\1/g,
		/\bimport\s*(["'])([^"'\n]+)\1/g,
		/\bimport\s*\(\s*(["'])([^"'\n]+)\1\s*\)/g,
		/\brequire\s*\(\s*(["'])([^"'\n]+)\1\s*\)/g
	];
	static #DIRECTIVE = /^\s*\/\/\/\s*<reference\s+types\s*=\s*(["'])([^"'\n]+)\1/gm;

	/**
	 * @param text The declaration
	 * @param importer The importer every reference is resolved from
	 * @param excluded Names that are not references
	 */
	static of(text: string, importer: string, excluded: (specifier: string) => boolean = () => false): ITypesReference[] {
		const found: [number, string][] = [];
		for (const match of text.matchAll(References.#DIRECTIVE)) found.push([match.index, match[2]]);
		const code = References.#code(text);
		References.#PATTERNS.forEach(pattern => {
			for (const match of code.matchAll(pattern)) found.push([match.index, match[2]]);
		});

		const specifiers = found.sort(([a], [b]) => a - b).map(([, specifier]) => specifier.trim());
		const unique = [...new Set(specifiers)].filter(specifier => References.#bare(specifier) && !excluded(specifier));
		return unique.slice(0, References.LIMIT).map(specifier => ({ specifier, importer }));
	}

	/**
	 * Whether a specifier names a package a type check resolves by name
	 */
	static #bare(specifier: string): boolean {
		if (!specifier || /^[./\\#]/.test(specifier) || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(specifier)) return false;
		const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
		return !builtinModules.includes(name);
	}

	/**
	 * The text with its comments replaced by spaces, so the positions stay; strings and template literals are kept
	 */
	static #code(text: string): string {
		const out: string[] = [];
		let quote: string | undefined;
		for (let index = 0; index < text.length; index++) {
			const char = text[index];
			const next = text[index + 1];
			if (quote) {
				out.push(char);
				if (char === '\\') out.push(text[++index] ?? '');
				else if (char === quote) quote = void 0;
				continue;
			}
			if (char === '"' || char === "'" || char === '`') {
				quote = char;
				out.push(char);
				continue;
			}
			if (char === '/' && (next === '/' || next === '*')) {
				const end = next === '/' ? text.indexOf('\n', index) : text.indexOf('*/', index + 2);
				const stop = end === -1 ? text.length : next === '/' ? end : end + 2;
				out.push(text.slice(index, stop).replace(/[^\n]/g, ' '));
				index = stop - 1;
				continue;
			}
			out.push(char);
		}
		return out.join('');
	}
}
