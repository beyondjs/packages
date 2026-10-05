import type { Package } from '@beyond-js/packages/package';
import { Declaration } from './declaration';

/**
 * The ambient modules a program declares for the modules of the workspace it imports.
 *
 * A declaration names its internal modules after the versioned identity of its module and declares the public
 * specifier last. A program holds each instance once, and one ambient module per public specifier: when
 * another instance of a package was declared first, a second one contributes its internal modules alone. A
 * module imported under another name than its public one, an alias of a member, is declared by that name too,
 * with the exports of the instance the alias reaches.
 */
export class Ambient {
	// The instance that declares each public specifier, and the instances the program holds
	#declared: Map<string, string> = new Map();
	#held: Set<string> = new Set();

	/**
	 * What a program declares for a specifier it imports, which reached a module of a package of the workspace
	 *
	 * @param specifier The specifier as the importer writes it
	 * @param code The declaration of the module
	 * @param subpath The subpath of the module in its package
	 * @returns The declarations to add, empty when the program already holds them
	 */
	add(specifier: string, code: string, pkg: Package, subpath: string): string {
		const path = subpath === '.' ? '' : `/${subpath.slice(2)}`;
		const [specified, instance] = [`${pkg.name}${path}`, `${pkg.vname}${path}`];

		let text = '';
		if (!this.#held.has(instance)) {
			const declared = this.#declared.has(specified);
			text = declared ? Declaration.internal(code, specified) : code;
			!declared && this.#declared.set(specified, instance);
			this.#held.add(instance);
		}
		return specifier === specified ? text : `${text}${text ? '\n' : ''}${Declaration.alias(code, specified, specifier)}`;
	}
}
