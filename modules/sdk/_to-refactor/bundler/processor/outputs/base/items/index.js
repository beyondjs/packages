const Issues = require('./issues');
const Item = require('./item');
const Generated = require('./generated');

module.exports = class extends Map {
	#issues = new Issues();
	get issues() {
		return this.#issues;
	}

	#generated = new Generated();
	get generated() {
		return this.#generated;
	}

	get(file) {
		if (this.has(file.relative.file)) {
			return super.get(file.relative.file);
		}

		const item = new Item(file);
		super.set(file.relative.file, item);
		return item;
	}

	set(item) {
		if (!(item instanceof Item)) {
			throw new Error(`Invalid item, expected an instance of Item`);
		}

		super.set(item.source.relative.file, item);
		return this;
	}
};
