/**
 * The text of a JSON manifest, edited the way a person edits it: the value of one name in one group is replaced, or
 * the name is added to the group, or the group is added to the manifest; everything else (the order of keys, the
 * indentation in tabs or spaces, the line endings, the final newline, every other field) is kept byte for byte.
 *
 * ```js
 * const text = new ManifestText(source);
 * text.set('dependencies', 'react', '^19.1.0');
 * text.text;   // the edited source
 * ```
 *
 * @throws {SyntaxError} When the text is not a JSON object
 */
export class ManifestText {
	#text;

	constructor(text) {
		this.#text = String(text);
		const root = new Scanner(this.#text).document();
		if (root.kind !== 'object') throw new SyntaxError('A manifest is a JSON object');
	}

	get text() {
		return this.#text;
	}

	/**
	 * The value a group declares for a name, or undefined
	 */
	get(group, name) {
		const value = JSON.parse(this.#text)?.[group]?.[name];
		return typeof value === 'string' ? value : void 0;
	}

	/**
	 * Sets the range of a name in a group
	 *
	 * @param {string} group `dependencies`, `devDependencies`, `peerDependencies` or `optionalDependencies`
	 * @param {string} name
	 * @param {string} range
	 */
	set(group, name, range) {
		const text = this.#text;
		const root = new Scanner(text).document();
		const declared = root.members.get(group);
		const value = JSON.stringify(range);
		if (declared && declared.value.kind !== 'object') throw new SyntaxError(`"${group}" is not an object`);

		if (declared?.value.members.has(name)) {
			const { start, end } = declared.value.members.get(name).value;
			this.#text = text.slice(0, start) + value + text.slice(end);
			return this;
		}
		const unit = ManifestText.#unit(text, root);
		const colon = ManifestText.#colon(text, declared?.value) ?? ManifestText.#colon(text, root) ?? ': ';
		if (declared) {
			this.#text = ManifestText.#append(text, declared.value, `${JSON.stringify(name)}${colon}${value}`, ManifestText.#indent(text, declared), unit);
			return this;
		}
		const [line, outer] = [ManifestText.#line(text), ManifestText.#outer(text, root) || unit];
		const member = `${JSON.stringify(group)}${colon}{${line}${outer}${unit}${JSON.stringify(name)}${colon}${value}${line}${outer}}`;
		this.#text = ManifestText.#append(text, root, member, '', unit);
		return this;
	}

	/**
	 * What separates a key from its value in the last member of an object (`": "`, `":"`), when it has one
	 */
	static #colon(text, object) {
		const members = object?.members ? [...object.members.values()] : [];
		const last = members[members.length - 1];
		return last ? text.slice(last.key.end, last.value.start) : void 0;
	}

	/**
	 * The line ending the text uses
	 */
	static #line(text) {
		return text.includes('\r\n') ? '\r\n' : '\n';
	}

	/**
	 * The indentation of the members of the top-level object
	 */
	static #outer(text, root) {
		const first = [...root.members.values()][0];
		return first ? ManifestText.#indent(text, first) : '';
	}

	/**
	 * One level of indentation: a tab when the manifest indents with tabs, else its top-level indentation
	 */
	static #unit(text, root) {
		const outer = ManifestText.#outer(text, root);
		if (outer.includes('\t')) return '\t';
		return outer || '\t';
	}

	/**
	 * The indentation of the line a member's key starts on
	 */
	static #indent(text, member) {
		const start = text.lastIndexOf('\n', member.key.start - 1) + 1;
		return text.slice(start, member.key.start).replace(/[^\t ]/g, '');
	}

	/**
	 * Adds a member as the last of an object: after the last member, with the separator that precedes it, or alone in
	 * an empty object, indented one level below the object's own line
	 */
	static #append(text, object, member, indent, unit) {
		const members = [...object.members.values()];
		const last = members[members.length - 1];
		if (last) {
			const separator = text.slice(text.lastIndexOf(',', last.key.start) + 1, last.key.start);
			const leading = members.length > 1 ? separator : text.slice(object.start + 1, last.key.start);
			return text.slice(0, last.value.end) + ',' + leading + member + text.slice(last.value.end);
		}
		const line = ManifestText.#line(text);
		const close = object.end - 1;
		return text.slice(0, object.start + 1) + line + indent + unit + member + line + indent + text.slice(close);
	}
}

/**
 * A scanner of JSON text that records where each value and each object member is, which is what lets an edit
 * replace one value without serializing the document again
 */
class Scanner {
	#text;
	#at = 0;

	constructor(text) {
		this.#text = text;
	}

	/**
	 * The top-level value, which must be the whole text
	 */
	document() {
		const value = this.#value();
		this.#space();
		if (this.#at !== this.#text.length) this.#fail('Unexpected text after the document');
		return value;
	}

	#fail(message) {
		throw new SyntaxError(`${message} at offset ${this.#at}`);
	}

	#space() {
		while (/[\s﻿]/.test(this.#text[this.#at] ?? '')) this.#at++;
	}

	#value() {
		this.#space();
		const start = this.#at;
		const char = this.#text[start];
		if (char === '{') return this.#object(start);
		if (char === '[') return this.#array(start);
		if (char === '"') return { kind: 'string', start, end: this.#string() };
		const match = /^(-?\d+(\.\d+)?([eE][+-]?\d+)?|true|false|null)/.exec(this.#text.slice(start, start + 400));
		if (!match) this.#fail('Unexpected character');
		this.#at += match[0].length;
		return { kind: 'other', start, end: this.#at };
	}

	#string() {
		this.#at++;
		while (this.#at < this.#text.length) {
			const char = this.#text[this.#at++];
			if (char === '\\') this.#at++;
			else if (char === '"') return this.#at;
		}
		this.#fail('Unterminated string');
	}

	#object(start) {
		const members = new Map();
		this.#at++;
		this.#space();
		if (this.#text[this.#at] === '}') return { kind: 'object', start, end: ++this.#at, members };
		for (;;) {
			this.#space();
			if (this.#text[this.#at] !== '"') this.#fail('Expected a key');
			const key = { start: this.#at, end: this.#string() };
			this.#space();
			if (this.#text[this.#at++] !== ':') this.#fail('Expected ":"');
			const value = this.#value();
			members.set(JSON.parse(this.#text.slice(key.start, key.end)), { key, value });
			this.#space();
			const next = this.#text[this.#at++];
			if (next === '}') return { kind: 'object', start, end: this.#at, members };
			if (next !== ',') this.#fail('Expected "," or "}"');
		}
	}

	#array(start) {
		this.#at++;
		this.#space();
		if (this.#text[this.#at] === ']') return { kind: 'array', start, end: ++this.#at };
		for (;;) {
			this.#value();
			this.#space();
			const next = this.#text[this.#at++];
			if (next === ']') return { kind: 'array', start, end: this.#at };
			if (next !== ',') this.#fail('Expected "," or "]"');
		}
	}
}
