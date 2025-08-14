import { storage } from '#store';

const { PackageFile } = storage;

module.exports = class {
	#pkg: string;
	get pkg() {
		return this.#pkg;
	}

	#version: string;
	get version() {
		return this.#version;
	}

	#path: string;
	get path() {
		return this.#path;
	}

	#size: number;
	get size() {
		return this.#size;
	}

	#mtime: number;
	get mtime() {
		return this.#mtime;
	}

	#type: string;
	get type() {
		return this.#type;
	}

	#error;
	get error() {
		return this.#error;
	}

	get valid() {
		return !this.#error;
	}

	#content;
	get content() {
		return this.#content;
	}

	constructor(pkg: string, version: string, { path, size, mtime, type }) {
		if (!pkg || !version) throw new Error('Invalid parameters');

		this.#pkg = pkg;
		this.#version = version;

		this.#path = path;
		this.#size = size;
		this.#mtime = mtime.toDate ? mtime.toDate() : mtime;
		this.#type = type;
	}

	async process() {
		const source = `${this.#pkg}@${this.#version}/${this.#path}`;
		const file = new PackageFile(source);
		await file.load();

		const { valid, error, content } = file;
		valid ? (this.#content = content) : (this.#error = error);
	}

	toJSON() {
		const { path, size, mtime, type } = this;
		return { path, size, mtime, type };
	}
};
