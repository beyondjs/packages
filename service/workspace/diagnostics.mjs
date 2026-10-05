/**
 * The findings of reading a workspace declaration, in the order they were found. Each one is
 * `{code, message, severity, paths?}`: an error makes the declaration invalid, a warning does not, and
 * `paths` names the files or directories involved when there are any.
 */
export class Diagnostics {
	#list = [];

	/**
	 * The diagnostics found so far, each one frozen
	 */
	get list() {
		return [...this.#list];
	}

	/**
	 * Whether no error was found
	 */
	get valid() {
		return !this.#list.some(({ severity }) => severity === 'error');
	}

	/**
	 * Records an error
	 *
	 * @param {string} code
	 * @param {string} message
	 * @param {string[]} [paths]
	 */
	error(code, message, paths) {
		this.#add('error', code, message, paths);
	}

	/**
	 * Records a warning
	 *
	 * @param {string} code
	 * @param {string} message
	 * @param {string[]} [paths]
	 */
	warning(code, message, paths) {
		this.#add('warning', code, message, paths);
	}

	#add(severity, code, message, paths) {
		const diagnostic = { code, message, severity };
		if (paths?.length) diagnostic.paths = Object.freeze([...paths]);
		this.#list.push(Object.freeze(diagnostic));
	}
}
