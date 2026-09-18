import { ConditionalOutput } from '@beyond-js/packages/module/output';

export type CodeOutputType = 'raw-code' | 'sourcemap-inline';

export type MapType = 'string' | 'object' | 'base64';

/**
 * The code a processor produces for one source file, with what the conditional needs to assemble it into
 * the artifact of the public module.
 *
 * The code itself is the body of a runtime internal module. The collections describe its boundaries: which
 * names it publishes, which sibling internal modules it republishes, and which other public modules it
 * depends on. A processor fills them from the code it emitted; the conditional decides, from the entry
 * point of the module, which of those names become its public API.
 */
export class CodeOutput extends ConditionalOutput {
	#exports = new Set<string>();

	/**
	 * The names this internal module exports, including the ones it re-exports by name
	 */
	get exports() {
		return this.#exports;
	}

	#reexports = new Set<string>();

	/**
	 * The relative specifiers of the internal modules this one re-exports entirely (`export * from`), whose
	 * names it publishes as its own
	 */
	get reexports() {
		return this.#reexports;
	}

	#dependencies = new Set<string>();

	/**
	 * The bare specifiers this internal module requires: the public modules its package depends on.
	 * Relative specifiers address internal modules and are not part of this set.
	 */
	get dependencies() {
		return this.#dependencies;
	}

	set(values: { code: string; map: string | object }) {
		if (typeof values !== 'object') throw new Error('Invalid parameters');

		const { code, map } = values;
		super.set({ code, map });
	}
}
