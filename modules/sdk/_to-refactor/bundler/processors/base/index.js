const DynamicProcessor = require('@beyond-js/dynamic-processor')(Map);
const equal = require('@beyond-js/equal');

/**
 * The processors of a bundler
 */
module.exports = class extends DynamicProcessor {
	get dp() {
		return 'bundler.processors';
	}

	#conditional;
	get conditional() {
		return this.#conditional;
	}

	#specs;
	get specs() {
		return this.#specs;
	}

	#errors = [];
	get errors() {
		return this.#errors;
	}

	#warnings = [];
	get warnings() {
		return this.#warnings;
	}

	get valid() {
		return !this.#errors?.length;
	}

	constructor(conditional) {
		super();
		this.#conditional = conditional;
	}

	/**
	 * Used to resolve the processor specifier if it is not provided in the processor data
	 * Actually used by the @beyond-js/bundlers-sdk/bundler/processors/resolver
	 *
	 * @param {*} The name of the processor to resolve
	 * @returns
	 */
	_resolve(name) {
		void name;
		return { error: `Processor "${name}" not found in the bundler settings` };
	}

	_process() {
		const done = ({ errors, warnings, updated }) => {
			const previous = { errors: this.#errors, warnings: this.#warnings };
			const changed =
				!equal({ errors, warnings }, previous) ||
				updated.size !== this.size ||
				updated.forEach((value, key) => (changed = changed || !this.has(key)));
			if (!changed) return false;

			this.#errors = errors || [];
			this.#warnings = warnings || [];

			// Destroy unused processors
			this.forEach((processor, name) => !updated.has(name) && processor.destroy());

			super.clear(); // Do not use this.clear() as it would destroy still used processors
			updated.forEach((value, key) => this.set(key, value));
		};

		let { processors, errors, warnings } = this.#conditional._processors();
		errors = errors || [];
		warnings = warnings || [];
		if (errors.length) return done({ errors, warnings });

		const updated = new Map();
		for (const [name, data] of processors.entries()) {
			const { specs } = data;
			let specifier = data.specifier;
			if (!specifier) {
				const resolved = this._resolve(name);
				if (resolved.error) {
					errors.push(resolved.error);
					continue;
				}

				specifier = resolved.specifier;
			}

			if (this.has(name)) {
				updated.set(name, this.get(name));
				this.get(name).specs.values = specs;
				continue;
			}

			let resolved = null;
			try {
				const { module } = this.#conditional;
				resolved = require.resolve(specifier, { paths: [module.package.path] });
			} catch (exc) {
				console.error(exc);
				errors.push(`Error resolving processor "${specifier}": ${exc.message}`);
				continue;
			}

			try {
				const Processor = require(resolved);
				const processor = new Processor(this.#conditional, name, specifier);
				processor.specs.values = specs;

				updated.set(name, processor);
			} catch (exc) {
				console.error(exc);
				errors.push(`Error requiring processor "${specifier}": ${exc.message}`);
				continue;
			}
		}
		return done({ errors, warnings, updated });
	}

	clear() {
		this.forEach(processor => processor.destroy());
		super.clear();
	}

	destroy() {
		this.clear();
		super.destroy();
	}
};
