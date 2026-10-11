import type { Confinement } from '@beyond-js/packages/confinement';
import { existsSync, readFileSync, statSync } from 'fs';
import { dirname, isAbsolute, resolve } from 'path';
import { fileURLToPath } from 'url';

/**
 * The input source maps a confined build lets the compiler read.
 *
 * The compiler follows the last `sourceMappingURL` comment of a JavaScript or CSS file (`//# `, `//@ `, `/*# `,
 * `/*@ `) to a map, reading a map file from disk relative to the file, and fills each source the map names
 * without content by reading that source from disk, relative to the map. None of that passes through a plugin:
 * a package could make the compiler read, and put into its output map or its error, any file of the machine.
 *
 * A map is kept only when nothing it makes the compiler read leaves the package: an inline `data:` map, or a
 * plain relative path to a map inside the package, whose sources either carry their content, name an address
 * the compiler never reads (`webpack://`), or are files inside the package. Any other map is overridden: an
 * empty inline map is appended to the file, which the compiler takes as its last comment, so it reads nothing
 * and compiles the file without an input map. The code of the file is unchanged.
 */
export class Maps {
	/**
	 * A source map comment as the compiler recognizes it, in JavaScript and in CSS. The asterisk is written as
	 * `\x2a` here and the comment delimiters below are written in two parts, so that no tool reading this source
	 * takes them for a comment of its own.
	 */
	static PATTERN = /\/[\/\x2a][#@] sourceMappingURL=(\S+)/g;

	/**
	 * An inline map without sources, which the compiler ignores
	 */
	static EMPTY = `data:application/json;base64,${Buffer.from('{"version":3,"sources":[],"names":[],"mappings":""}').toString('base64')}`;

	#confinement: Confinement;

	constructor(confinement: Confinement) {
		this.#confinement = confinement;
	}

	/**
	 * The contents to compile instead of the file's own when a map it names would make the compiler read
	 * outside the package; undefined when every map it names is kept
	 *
	 * @param css Whether the file is a stylesheet, which writes the comment in its own form
	 */
	neutralize(file: string, contents: string, css: boolean): string | undefined {
		const urls = [...contents.matchAll(Maps.PATTERN)].map(([, url]) => url.replace(/\*\/$/, ''));
		if (urls.every(url => this.#kept(file, url))) return;
		const [open, close] = css ? ['/' + '*', ' *' + '/'] : ['/' + '/', ''];
		return `${contents}\n${open}# sourceMappingURL=${Maps.EMPTY}${close}\n`;
	}

	#kept(file: string, url: string): boolean {
		if (/^data:/i.test(url)) return this.#contained(this.#data(url), file);

		// Only a plain relative path is resolved here exactly as the compiler resolves it
		if (!/^[^:%\\?#]+$/.test(url) || url.startsWith('/')) return false;
		const path = resolve(dirname(file), url);
		if (!this.#confinement.contains(path)) return false;
		if (!existsSync(path)) return true;
		if (!statSync(path).isFile() || !this.#confinement.inside(path)) return false;
		return this.#contained(this.#json(readFileSync(path, 'utf8')), path);
	}

	#data(url: string): unknown {
		const comma = url.indexOf(',');
		if (comma === -1) return;
		const [meta, body] = [url.slice(0, comma), url.slice(comma + 1)];
		try {
			return this.#json(/;base64$/i.test(meta) ? Buffer.from(body, 'base64').toString('utf8') : decodeURIComponent(body));
		} catch {
			return;
		}
	}

	#json(text: string): unknown {
		try {
			return JSON.parse(text);
		} catch {
			return;
		}
	}

	/**
	 * Whether the compiler reads nothing outside the package for a map
	 *
	 * @param location What the sources of the map are relative to: the map file, or the file of an inline map
	 */
	#contained(map: unknown, location: string): boolean {
		if (!map || typeof map !== 'object' || 'sections' in map) return false;
		const { sources, sourcesContent, sourceRoot } = <{ sources?: unknown; sourcesContent?: unknown; sourceRoot?: unknown }>map;
		if (!(sources instanceof Array)) return true;

		const contents = sourcesContent instanceof Array ? sourcesContent : [];
		// The compiler prefixes every source with the root up to its last slash, or with the root and a slash
		const root = typeof sourceRoot === 'string' ? sourceRoot : '';
		const cut = root.lastIndexOf('/');
		const prefix = root && (cut === -1 ? root + '/' : root.slice(0, cut + 1));
		const read = (source: unknown, index: number) => typeof source === 'string' && typeof contents[index] !== 'string';
		return sources.every((source, index) => !read(source, index) || this.#source(`${prefix}${source}`, location));
	}

	/**
	 * Whether a source the compiler would read to fill its content is inside the package; one it never reads,
	 * an address of another scheme, is too, and anything it might resolve differently is not
	 */
	#source(source: string, location: string): boolean {
		if (/[%\\?#]/.test(source)) return false;
		let path: string;
		if (/^file:/i.test(source)) {
			try {
				path = fileURLToPath(source);
			} catch {
				return false;
			}
		} else if (/^[a-z][a-z0-9+.-]*:/i.test(source)) return true;
		else path = isAbsolute(source) ? source : resolve(dirname(location), source);
		return this.#confinement.contains(path) && (!existsSync(path) || this.#confinement.inside(path));
	}
}
