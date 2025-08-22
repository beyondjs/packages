/**
 * The children of the compiler are not disposed at startup, since the processed data can be loaded from the cache
 */
module.exports = class {
	#compiler;
	get compiler() {
		return this.#compiler;
	}

	#disposed = false;
	get disposed() {
		return this.#disposed;
	}

	constructor(compiler) {
		this.#compiler = compiler;
	}
};
