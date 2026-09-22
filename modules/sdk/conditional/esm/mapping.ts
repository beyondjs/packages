import type { IInternalModule } from './';
import { SourceMapGenerator } from 'source-map';

/**
 * The source map of one internal module, as the artifact carries it.
 *
 * A transformer names the source of its map as it pleases: TypeScript writes the base name of the file, so
 * two sources in different directories collapse into one name, and none of them can be found from the
 * artifact. The artifact names every source by its absolute path, in every delivery: written beside the
 * artifact, inlined in an update or inlined in the answer of a development service. A tool that remaps
 * coverage or a stack trace then finds the file wherever the artifact was loaded from, and the writer of a
 * file artifact makes the paths relative to the file it writes.
 *
 * The content of the sources is carried entirely or not at all: an array that holds `null` for some of them
 * makes a coverage tool report every source as fully covered.
 *
 * The lines that open and close the creator of the internal module are mapped as well, to the first and the
 * last line of the source, so that a coverage report attributes the import and top-level lines of the source
 * instead of skipping a function range whose start has no mapping.
 */
export class Mapping {
	#file: string;

	/**
	 * The absolute path of the source, with forward slashes
	 */
	get file() {
		return this.#file;
	}

	/**
	 * The last position of the source: its last line, after its last character
	 */
	#end: { line: number; column: number };

	#map: string | undefined;

	/**
	 * The map of the transformed code, naming the source by its absolute path
	 */
	get map() {
		return this.#map;
	}

	constructor({ output }: IInternalModule) {
		const { source, code } = output;
		this.#file = source.file.replace(/\\/g, '/');
		this.#end = Mapping.#ending(typeof source.content === 'string' ? source.content : '');
		const map = code.map();
		this.#map = this.#normalize(typeof map === 'string' ? map : void 0);
	}

	/**
	 * A trailing line break ends the last line; it does not open a line the file does not have
	 */
	static #ending(content: string) {
		const lines = content.split('\n');
		lines.length > 1 && lines[lines.length - 1] === '' && lines.pop();
		return { line: lines.length, column: lines[lines.length - 1].length };
	}

	#normalize(map: string | undefined): string | undefined {
		if (!map) return;

		let parsed: { sources?: string[]; sourceRoot?: string; sourcesContent?: (string | null)[] };
		try {
			parsed = JSON.parse(map);
		} catch {
			return;
		}
		if (!(parsed.sources instanceof Array)) return;

		// Whatever name the transformer wrote, the source of a per-file map is this file
		parsed.sources = parsed.sources.map(() => this.#file);
		delete parsed.sourceRoot;
		if (parsed.sourcesContent instanceof Array && parsed.sourcesContent.some(content => typeof content !== 'string')) {
			delete parsed.sourcesContent;
		}
		return JSON.stringify(parsed);
	}

	/**
	 * The map of the line that opens the creator: the beginning of the source
	 */
	get opening() {
		return this.#boundary({ line: 1, column: 0 });
	}

	/**
	 * The map of the line that closes the creator: the end of the source
	 */
	get closing() {
		return this.#boundary(this.#end);
	}

	#boundary(original: { line: number; column: number }): string {
		const generator = new SourceMapGenerator();
		generator.addMapping({ generated: { line: 1, column: 0 }, original, source: this.#file });
		return generator.toString();
	}
}
