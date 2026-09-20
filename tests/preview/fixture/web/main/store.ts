/**
 * State that lives in an internal module. An update of another file of the module must not reset it.
 */
export const store = {
	count: 0,
	add(): number {
		return ++this.count;
	}
};

// When this page evaluated the module, which a reload changes and an update does not
(<any>globalThis).evaluated = { ...(<any>globalThis).evaluated, store: ((<any>globalThis).evaluated?.store ?? 0) + 1 };
