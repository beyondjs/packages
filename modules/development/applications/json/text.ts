import { Scanner, type IJsonMember, type IJsonNode } from './scanner';
import { Style } from './style';

const own = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);
const plain = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * A JSON document edited in place: a member is replaced, added or removed by rewriting only its own characters, so
 * every other member keeps its text, its key order, the indentation of the document (tabs or spaces as found), its
 * newlines and its final newline. A value that is replaced by another object is edited member by member, so what did
 * not change keeps how it was written, one-line objects included; members it adds are added after the existing ones.
 *
 * ```ts
 * const text = new JsonText(source);
 * text.update(['applications', 'site'], { title: 'Site', targets: {} });
 * text.remove(['applications', 'old']);
 * text.text;
 * ```
 *
 * Where JSON allows a key twice, the last one is the value (as `JSON.parse` reads it), and removing a key removes
 * every one of them.
 */
export class JsonText {
	#text: string;
	get text() {
		return this.#text;
	}

	/**
	 * @throws SyntaxError when the text is not JSON
	 */
	constructor(text: string) {
		Scanner.scan(text);
		this.#text = text;
	}

	#scan(): { root: IJsonNode; style: Style } {
		const root = Scanner.scan(this.#text);
		return { root, style: new Style(this.#text, root) };
	}

	#splice(start: number, end: number, text: string) {
		this.#text = this.#text.slice(0, start) + text + this.#text.slice(end);
	}

	/**
	 * The last member of an object with a key, which is the one JSON reads
	 */
	static #member(node: IJsonNode, key: string): IJsonMember | undefined {
		const members = node.type === 'object' ? node.members : [];
		for (let i = members.length - 1; i >= 0; i--) if (members[i].key === key) return members[i];
	}

	/**
	 * The member a path names and the object it is in, or the deepest object of the path that exists
	 */
	#locate(path: string[]): { parent: IJsonNode; member?: IJsonMember; depth: number; style: Style } {
		const { root, style } = this.#scan();
		let parent = root;
		for (let depth = 0; depth < path.length; depth++) {
			const member = JsonText.#member(parent, path[depth]);
			if (!member || depth === path.length - 1) return { parent, member, depth, style };
			if (member.value.type !== 'object') throw new TypeError(`"${path.slice(0, depth + 1).join('.')}" is not an object`);
			parent = member.value;
		}
		return { parent, depth: 0, style };
	}

	/**
	 * Makes the member a path names hold a value, creating the objects of the path that are missing
	 *
	 * @throws TypeError when the path crosses a value that is not an object
	 */
	update(path: string[], value: unknown): void {
		if (!path.length) throw new TypeError('A member is named by a path of one key at least');
		const { parent, member, depth, style } = this.#locate(path);
		if (parent.type !== 'object') throw new TypeError('The document is not an object');
		if (!member) return this.#insert(parent, path[depth], JsonText.#nest(path.slice(depth + 1), value), style);

		const current = JSON.parse(this.#text.slice(member.value.start, member.value.end));
		if (JsonText.same(current, value)) return;
		if (member.value.type === 'object' && plain(current) && plain(value)) {
			Object.keys(current).filter(key => !own(value, key)).forEach(key => this.remove([...path, key]));
			Object.entries(value).forEach(([key, inner]) => this.update([...path, key], inner));
			return;
		}

		// A value written on one line stays on one line: an object or array that was, or any value of an object that is
		const { start, end } = member.value;
		const inline = !this.#text.slice(start, end).includes('\n') && (member.value.type !== 'value' || this.#inline(parent));
		this.#splice(start, end, style.write(value, style.indentation(member.start), inline));
	}

	/**
	 * Whether an object is written on one line, which is how what is added to it is written
	 */
	#inline(node: IJsonNode): boolean {
		return !this.#text.slice(node.start, node.end).includes('\n');
	}

	static #nest(path: string[], value: unknown): unknown {
		return path.reduceRight<unknown>((inner, key) => ({ [key]: inner }), value);
	}

	#insert(object: IJsonNode, key: string, value: unknown, style: Style) {
		const members = object.members;
		const inline = !!members.length && this.#inline(object);
		const entry = (indentation: string) => `${JSON.stringify(key)}${style.separator}${style.write(value, indentation, inline)}`;

		if (!members.length) {
			if (style.compact) return this.#splice(object.start, object.end, `{${entry('')}}`);
			const outer = style.indentation(object.start);
			const inner = outer + style.unit;
			return this.#splice(object.start, object.end, `{${style.newline}${inner}${entry(inner)}${style.newline}${outer}}`);
		}

		const last = members[members.length - 1];
		if (inline) {
			const comma = members.length > 1 ? this.#text.slice(members[0].value.end, members[1].start) : style.compact ? ',' : ', ';
			return this.#splice(last.value.end, last.value.end, `${comma}${entry('')}`);
		}
		const indentation = style.indentation(members[0].start);
		this.#splice(last.value.end, last.value.end, `,${style.newline}${indentation}${entry(indentation)}`);
	}

	/**
	 * Removes every member a path names, with the separator that went with it
	 *
	 * @returns Whether something was removed
	 */
	remove(path: string[]): boolean {
		let removed = false;
		for (;;) {
			const { parent, member } = this.#locate(path);
			if (!member) return removed;
			const members = parent.members;
			const index = members.indexOf(member);
			if (members.length === 1) this.#splice(parent.start, parent.end, '{}');
			else if (index < members.length - 1) this.#splice(member.start, members[index + 1].start, '');
			else this.#splice(members[index - 1].value.end, member.value.end, '');
			removed = true;
		}
	}

	/**
	 * Whether two JSON values are the same, whatever the order of the keys of their objects
	 */
	static same(a: unknown, b: unknown): boolean {
		if (a === b) return true;
		if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
		if (Array.isArray(a) || Array.isArray(b)) {
			if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
			return a.every((item, index) => JsonText.same(item, b[index]));
		}
		const keys = Object.keys(a);
		if (keys.length !== Object.keys(b).length) return false;
		return keys.every(key => own(b, key) && JsonText.same((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
	}
}
