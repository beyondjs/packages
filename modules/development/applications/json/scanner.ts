/**
 * A value of a JSON text with where it is: `start` is the index of its first character and `end` the index after its
 * last one. An object lists its members in the order they are written.
 */
export interface IJsonNode {
	type: 'object' | 'array' | 'value';
	start: number;
	end: number;
	members?: IJsonMember[];
}

/**
 * A member of an object: its key as JSON reads it, where its key starts and its value
 */
export interface IJsonMember {
	key: string;
	start: number;
	value: IJsonNode;
}

/**
 * Finds where the values of a JSON text are, so that one member can be replaced, added or removed while every other
 * character of the text stays as it was written: key order, indentation, spacing and the final newline. It reads a
 * text `JSON.parse` accepts, with a byte order mark allowed before it, and throws on anything else.
 */
export class Scanner {
	static #NUMBER = /-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/y;
	static #LITERAL = /true|false|null/y;

	#text: string;
	#index = 0;

	/**
	 * The root value of a text
	 */
	static scan(text: string): IJsonNode {
		const scanner = new Scanner(text);
		if (text.charCodeAt(0) === 0xfeff) scanner.#index = 1;
		scanner.#space();
		const root = scanner.#value();
		scanner.#space();
		if (scanner.#index !== text.length) scanner.#fail('unexpected text after the document');
		return root;
	}

	private constructor(text: string) {
		this.#text = text;
	}

	#fail(reason: string): never {
		throw new SyntaxError(`Not a JSON text at ${this.#index}: ${reason}`);
	}

	#space() {
		while (this.#index < this.#text.length && ' \t\n\r'.includes(this.#text[this.#index])) this.#index++;
	}

	#expect(character: string) {
		if (this.#text[this.#index] !== character) this.#fail(`"${character}" was expected`);
		this.#index++;
	}

	#value(): IJsonNode {
		const character = this.#text[this.#index];
		if (character === '{') return this.#object();
		if (character === '[') return this.#array();
		const start = this.#index;
		if (character === '"') this.#string();
		else this.#token(character === '-' || (character >= '0' && character <= '9') ? Scanner.#NUMBER : Scanner.#LITERAL);
		return { type: 'value', start, end: this.#index };
	}

	#token(pattern: RegExp) {
		pattern.lastIndex = this.#index;
		if (!pattern.test(this.#text)) this.#fail('a value was expected');
		this.#index = pattern.lastIndex;
	}

	#string(): string {
		const start = this.#index;
		this.#expect('"');
		for (;;) {
			const character = this.#text[this.#index++];
			if (character === undefined) this.#fail('the string does not end');
			if (character === '\\') this.#index++;
			else if (character === '"') break;
		}
		return JSON.parse(this.#text.slice(start, this.#index));
	}

	#object(): IJsonNode {
		const start = this.#index;
		const members: IJsonMember[] = [];
		this.#expect('{');
		this.#space();
		if (this.#text[this.#index] === '}') {
			this.#index++;
			return { type: 'object', start, end: this.#index, members };
		}
		for (;;) {
			this.#space();
			const at = this.#index;
			const key = this.#string();
			this.#space();
			this.#expect(':');
			this.#space();
			members.push({ key, start: at, value: this.#value() });
			this.#space();
			if (this.#text[this.#index] === ',') {
				this.#index++;
				continue;
			}
			this.#expect('}');
			return { type: 'object', start, end: this.#index, members };
		}
	}

	#array(): IJsonNode {
		const start = this.#index;
		this.#expect('[');
		this.#space();
		if (this.#text[this.#index] === ']') {
			this.#index++;
			return { type: 'array', start, end: this.#index };
		}
		for (;;) {
			this.#space();
			this.#value();
			this.#space();
			if (this.#text[this.#index] === ',') {
				this.#index++;
				continue;
			}
			this.#expect(']');
			return { type: 'array', start, end: this.#index };
		}
	}
}
