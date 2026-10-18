/**
 * The runtime public module that artifacts are written against unless their bundler selects another one:
 * the legacy Kernel, which is what existing consumers have installed.
 */
export const KERNEL = '@beyond-js/kernel/bundle';

/**
 * The public-module families of the Kernel that a runtime selected in place of it provides under its own
 * package name. A composed module written against `@beyond-js/kernel/core` is assembled against
 * `<runtime package>/core` when its bundler selects that runtime, which is how the existing Widgets sources
 * run on the development runtime without a second copy of their imports.
 */
const FAMILIES = ['bundle', 'core', 'styles', 'routing'];

/**
 * How the bare specifiers of the internal modules map to the public modules the artifact imports.
 *
 * The internal modules keep requiring the specifiers their sources wrote, which the runtime package
 * resolves through the dependencies registered for them; only the import statements of the artifact name
 * the module of the selected runtime. Anything outside the Kernel families, and every specifier when the
 * runtime is the Kernel itself, is imported as written.
 */
export class Compatibility {
	#runtime: string;
	#name: string;

	/**
	 * @param runtime The runtime public module the artifact imports, such as `@scope/runtime/bundle`
	 */
	constructor(runtime: string) {
		this.#runtime = runtime;

		const segments = runtime.split('/');
		this.#name = segments.slice(0, runtime.startsWith('@') ? 2 : 1).join('/');
	}

	/**
	 * Whether the selected runtime is the legacy Kernel, whose identities need no mapping
	 */
	get kernel(): boolean {
		return this.#runtime === KERNEL;
	}

	/**
	 * The public module the artifact imports for a specifier its sources require
	 */
	resolve(specifier: string): string {
		if (this.kernel) return specifier;

		const prefix = '@beyond-js/kernel/';
		if (!specifier.startsWith(prefix)) return specifier;

		const family = specifier.slice(prefix.length);
		return FAMILIES.includes(family) ? `${this.#name}/${family}` : specifier;
	}
}
