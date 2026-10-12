/**
 * One step of resolving a subpath through the `exports` of a package: a target to try, relative to the package
 * (`./dist/index.d.ts`), or the end of the resolution in this package and why (`excluded` by a null target, an
 * `invalid` target, or one that would `escape` the package)
 */
export interface IExportsStep {
	target?: string;
	stop?: 'excluded' | 'invalid' | 'escape';
	value?: string;
}

/**
 * The `exports` of a package as TypeScript's `bundler` resolution reads them for a type check: the subpath is
 * matched exactly or by the most specific pattern (`./*`), and the conditions `types`, `import` and `default` apply,
 * in the order the package lists them, each tried in turn until one names a file that exists. A null target ends
 * the resolution, as does a target that does not start with `./` or holds a `.`, `..` or `node_modules` segment.
 *
 * Versioned conditions (`types@>=5.0`), `typesVersions` and custom conditions are not read: a package that relies on
 * them is browsed through what it declares without them.
 *
 * ```js
 * const exports = new Exports(manifest.exports);
 * const matched = exports.match('./server');
 * for (const step of matched ? exports.steps(matched) : []) …
 * ```
 */
export class Exports {
	static CONDITIONS = ['types', 'import', 'default'];

	#map: Record<string, unknown> | undefined;

	/**
	 * Whether the package declares exports
	 */
	get declared(): boolean {
		return !!this.#map;
	}

	/**
	 * @param exports The `exports` field of a manifest
	 */
	constructor(exports: unknown) {
		this.#map = Exports.#normalized(exports);
	}

	/**
	 * The subpaths of exports: a string, an array or an object of conditions is the target of `.`; an object that mixes
	 * subpaths and conditions exports nothing, as Node refuses it
	 */
	static #normalized(exports: unknown): Record<string, unknown> | undefined {
		if (typeof exports === 'string' || Array.isArray(exports)) return { '.': exports };
		if (!exports || typeof exports !== 'object') return;
		const keys = Object.keys(exports);
		const subpaths = keys.filter(key => key.startsWith('.'));
		if (!subpaths.length) return { '.': exports };
		return subpaths.length === keys.length ? <Record<string, unknown>>exports : {};
	}

	/**
	 * The order of two pattern keys, the most specific first: the longer part before `*`, then the longer key
	 */
	static #compare(a: string, b: string): number {
		const [baseA, baseB] = [a.indexOf('*') + 1 || a.length, b.indexOf('*') + 1 || b.length];
		if (baseA !== baseB) return baseB - baseA;
		return b.length - a.length;
	}

	/**
	 * What a subpath is exported as: its target and, for a pattern, what `*` stands for; undefined when the package
	 * does not export it
	 */
	match(subpath: string): { target: unknown; pattern?: string } | undefined {
		const map = this.#map;
		if (!map) return;
		if (Object.prototype.hasOwnProperty.call(map, subpath) && !subpath.includes('*')) return { target: map[subpath] };

		let best: string | undefined;
		for (const key of Object.keys(map)) {
			const star = key.indexOf('*');
			if (star === -1 || star !== key.lastIndexOf('*')) continue;
			const [prefix, suffix] = [key.slice(0, star), key.slice(star + 1)];
			if (!subpath.startsWith(prefix) || subpath === prefix) continue;
			if (suffix && (!subpath.endsWith(suffix) || subpath.length < key.length)) continue;
			if (!best || Exports.#compare(key, best) < 0) best = key;
		}
		if (!best) return;
		const star = best.indexOf('*');
		return { target: map[best], pattern: subpath.slice(star, subpath.length - (best.length - star - 1)) };
	}

	/**
	 * The steps of a matched subpath, in the order a type check tries them; a step that ends the resolution is the last
	 */
	steps({ target, pattern }: { target: unknown; pattern?: string }): IExportsStep[] {
		const steps: IExportsStep[] = [];
		Exports.#walk(target, pattern, steps);
		return steps;
	}

	/**
	 * Adds the steps of a target; true when one of them ends the resolution
	 */
	static #walk(value: unknown, pattern: string | undefined, steps: IExportsStep[]): boolean {
		const stop = (step: IExportsStep) => (steps.push(step), true);
		if (typeof value === 'string') {
			if (!value.startsWith('./')) return stop({ stop: 'invalid', value });
			const resolved = pattern === void 0 ? value : value.split('*').join(pattern);
			const segments = resolved.slice(2).split(/[\\/]/);
			if (segments.includes('..')) return stop({ stop: 'escape', value: resolved });
			if (segments.some(segment => segment === '.' || segment.toLowerCase() === 'node_modules')) return stop({ stop: 'invalid', value: resolved });
			steps.push({ target: resolved });
			return false;
		}
		if (value === null) return stop({ stop: 'excluded' });
		if (Array.isArray(value)) return value.some(one => Exports.#walk(one, pattern, steps));
		if (!value || typeof value !== 'object') return false;
		return Object.entries(value).some(([condition, nested]) => Exports.CONDITIONS.includes(condition) && Exports.#walk(nested, pattern, steps));
	}
}
