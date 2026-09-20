import { intersects, validRange } from 'semver';

export /*bundle*/ type OverridesType = Record<string, string | Record<string, any>>;

interface IRule {
	name: string;
	// Only requirements that intersect this range are replaced (`"foo@^2": "2.1.0"`)
	range?: string;
	// Packages that must be among the dependents, from the outermost to the innermost
	within: string[];
	value: string;
}

/**
 * Replaces the version a dependency is required with, as the `overrides` of the root manifest declare:
 *
 * - `"foo": "1.0.0"` replaces every requirement of foo; `"foo@^2": "2.1.0"` only those intersecting ^2
 * - `"bar": {"foo": "1.0.0"}` replaces foo only below bar; `"."` in a nested object replaces bar itself
 * - `"$foo"` as a value means the version the root requires foo with
 *
 * The most specific rule (deepest nesting) wins; rules are otherwise applied in a canonical order, so
 * the outcome does not depend on how the declaration was written.
 */
export /*bundle*/ class Overrides {
	#rules: IRule[] = [];
	#warnings: string[] = [];
	get warnings() {
		return this.#warnings;
	}

	get size() {
		return this.#rules.length;
	}

	/**
	 * The declared replacements, flattened: `within` lists the packages a rule is limited to
	 */
	get rules(): { name: string; range?: string; within: string[]; value: string }[] {
		return this.#rules.map(rule => ({ ...rule, within: [...rule.within] }));
	}

	constructor(values?: OverridesType, roots?: Map<string, { version: string }>) {
		if (!values || typeof values !== 'object') return;

		const read = (group: Record<string, any>, within: string[]) => {
			for (const key of Object.keys(group).sort()) {
				const value = group[key];
				const at = key.lastIndexOf('@');
				const name = at > 0 ? key.slice(0, at) : key;
				const range = at > 0 ? key.slice(at + 1) : void 0;

				if (typeof value === 'string') {
					const resolved = value.startsWith('$') ? roots?.get(value.slice(1))?.version : value;
					if (!resolved) {
						this.#warnings.push(`Override "${key}" references "${value}", which the root does not require`);
						continue;
					}
					if (key !== '.') {
						this.#rules.push({ name, range, within, value: resolved });
					} else if (within.length) {
						// "." names the package the group belongs to
						const owner = within[within.length - 1];
						this.#rules.push({ name: owner, within: within.slice(0, -1), value: resolved });
					}
				} else if (value && typeof value === 'object') {
					read(value, [...within, name]);
				} else {
					this.#warnings.push(`Override "${key}" is neither a version nor a group of overrides`);
				}
			}
		};
		read(values, []);

		// Deepest first; ties keep the canonical (sorted) order they were read in
		this.#rules = this.#rules
			.map((rule, index) => ({ rule, index }))
			.sort((a, b) => b.rule.within.length - a.rule.within.length || a.index - b.index)
			.map(({ rule }) => rule);
	}

	/**
	 * The version to require a dependency with
	 *
	 * @param name The name of the dependency
	 * @param declared The version its dependent declares
	 * @param dependents Names of the packages that lead to it, from the root to its direct dependent
	 */
	apply(name: string, declared: string, dependents: string[]): string {
		for (const rule of this.#rules) {
			if (rule.name !== name) continue;

			if (rule.range) {
				const comparable = validRange(rule.range) && validRange(declared);
				if (comparable ? !intersects(rule.range, declared) : rule.range !== declared) continue;
			}

			// Every package of the rule must appear among the dependents, in order
			let from = 0;
			const inside = rule.within.every(pkg => {
				const index = dependents.indexOf(pkg, from);
				from = index + 1;
				return index !== -1;
			});
			if (inside) return rule.value;
		}
		return declared;
	}
}
