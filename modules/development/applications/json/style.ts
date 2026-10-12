import type { IJsonNode } from './scanner';

/**
 * How a JSON text is written, so that what is added to it is written the same way: its newline, the unit of its
 * indentation (the indentation of its first indented line, tabs or spaces as found; a tab when it has none) and
 * whether the whole document is written on one line.
 */
export class Style {
	static UNIT = '\t';

	#text: string;

	#newline: string;
	get newline() {
		return this.#newline;
	}

	#unit: string;
	get unit() {
		return this.#unit;
	}

	#compact: boolean;

	/**
	 * Whether the document is written on one line, which is how what is added to it is written
	 */
	get compact() {
		return this.#compact;
	}

	#separator: string;

	/**
	 * What separates a key from its value, as the first member of the document writes it
	 */
	get separator() {
		return this.#separator;
	}

	constructor(text: string, root: IJsonNode) {
		this.#text = text;
		this.#newline = text.includes('\r\n') ? '\r\n' : '\n';
		this.#unit = /\n([ \t]+)\S/.exec(text)?.[1] ?? Style.UNIT;
		// An empty document `{}` is opened when something is added to it, as a new document is written
		this.#compact = !!root.members?.length && !text.slice(root.start, root.end).includes('\n');

		const first = root.members?.[0];
		const between = first ? text.slice(first.start, first.value.start) : '';
		this.#separator = between && !/:\s/.test(between) ? ':' : ': ';
	}

	/**
	 * The indentation of the line where a character is: the spaces and tabs that start that line
	 */
	indentation(index: number): string {
		const start = this.#text.lastIndexOf('\n', index - 1) + 1;
		return /^[ \t]*/.exec(this.#text.slice(start, index))[0];
	}

	/**
	 * A value as this document writes it, its lines after the first indented as the line it starts on
	 *
	 * @param inline Write it on one line, as the object it is added to is written
	 */
	write(value: unknown, indentation: string, inline = false): string {
		if (this.#compact || inline) return JSON.stringify(value);
		return JSON.stringify(value, null, this.#unit).split('\n').join(this.#newline + indentation);
	}

	/**
	 * A new document holding a value, written with a tab and a final newline
	 */
	static document(value: unknown): string {
		return `${JSON.stringify(value, null, Style.UNIT)}\n`;
	}
}
