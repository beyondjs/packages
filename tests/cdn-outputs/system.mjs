/**
 * A minimal System-like loader, enough to execute `System.register` outputs the way SystemJS does: named
 * dependencies, setters, live bindings, `export *` objects, `context.import()` and `context.meta`.
 *
 * It holds the code of each public module by its bare specifier. A dependency it does not hold (a Node
 * builtin) is imported natively and exposed as a namespace with its default.
 */
export class SystemLoader {
	#sources;
	#records = new Map();

	/**
	 * How many times each module was evaluated, which is how a check shows that a module is shared
	 */
	evaluations = new Map();

	/**
	 * @param sources The `System.register` code of each public module, by bare specifier
	 */
	constructor(sources) {
		this.#sources = sources;
	}

	/**
	 * The namespace of a module, evaluated once
	 */
	async import(specifier) {
		const record = this.#record(specifier);
		await record.done;
		return record.namespace;
	}

	#record(specifier, ancestors = new Set()) {
		if (this.#records.has(specifier)) return this.#records.get(specifier);

		const record = { namespace: Object.create(null), setters: new Set() };
		this.#records.set(specifier, record);
		record.done = this.#sources.has(specifier) ? this.#evaluate(specifier, record, ancestors) : this.#native(specifier, record);
		return record;
	}

	async #native(specifier, record) {
		Object.assign(record.namespace, await import(specifier));
	}

	async #evaluate(specifier, record, ancestors) {
		let registered;
		const System = { register: (dependencies, declare) => (registered = { dependencies, declare }) };
		new Function('System', this.#sources.get(specifier))(System);
		if (!registered) throw new Error(`"${specifier}" did not call System.register`);

		const publish = (name, value) => {
			if (typeof name === 'object') Object.assign(record.namespace, name);
			else record.namespace[name] = value;
			// Live bindings: every importer sees the new value
			record.setters.forEach(setter => setter(record.namespace));
			return value;
		};
		const context = { id: specifier, import: name => this.import(name), meta: { url: `system:${specifier}` } };
		const { setters = [], execute } = registered.declare(publish, context);

		for (const [index, name] of registered.dependencies.entries()) {
			const dependency = this.#record(name, new Set([...ancestors, specifier]));
			// A cycle is linked with what the dependency has published so far
			!ancestors.has(name) && name !== specifier && (await dependency.done);
			dependency.setters.add(setters[index]);
			setters[index](dependency.namespace);
		}

		this.evaluations.set(specifier, (this.evaluations.get(specifier) ?? 0) + 1);
		await execute?.();
	}
}
