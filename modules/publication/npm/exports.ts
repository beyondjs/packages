import type { IDiagnostic } from '@beyond-js/packages/types';

/**
 * Where a public subpath of an ordinary npm package resolves to
 */
export /*bundle*/ interface IResolvedExport {
	/**
	 * The target file, relative to the package root (`./cjs/index.js`), when the subpath resolves
	 */
	target?: string;

	/**
	 * The conditions or manifest field that selected the target, in the order they were matched
	 */
	via: string[];

	diagnostics: IDiagnostic[];
}

type Target = string | null | Target[] | { [condition: string]: Target };

/**
 * What an ordinary npm package publishes, and which file each public subpath resolves to for a set of
 * conditions.
 *
 * It follows Node's resolution of the `exports` field: subpath keys, the root shorthand, nested conditions
 * matched in the order the package wrote them, `default`, `null` exclusions, fallback arrays (first valid
 * target) and single-`*` patterns. Without `exports`, the root is the `browser` (string form, browser
 * platform only), `module` or `main` field, then `./index.js`, and any other subpath is a file of the
 * package. Every public subpath is its own public module: nothing here merges two of them.
 */
export /*bundle*/ class Exports {
	#manifest: Record<string, any>;

	get name(): string {
		return this.#manifest.name;
	}

	constructor(manifest: Record<string, any>) {
		this.#manifest = manifest ?? {};
	}

	/**
	 * The conditions that select targets for a platform and an environment, in no particular order: the
	 * order that matters is the one of the package.
	 */
	static conditions(platform: string, environment?: string): string[] {
		const browser = platform !== 'node';
		const values = [browser ? 'browser' : 'node', 'import', 'module', 'default'];
		environment && values.push(environment);
		return values;
	}

	/**
	 * The entries of the `exports` field, normalized to subpath keys
	 */
	get #entries(): Record<string, Target> | undefined {
		const { exports } = this.#manifest;
		if (exports === void 0 || exports === null) return;
		if (typeof exports === 'string' || exports instanceof Array) return { '.': exports };

		const keys = Object.keys(exports);
		return keys.length && keys.every(key => !key.startsWith('.')) ? { '.': exports } : exports;
	}

	/**
	 * The subpaths the package declares explicitly. Patterns are not enumerable and are left out.
	 */
	get subpaths(): string[] {
		const entries = this.#entries;
		if (!entries) return ['.'];
		return Object.keys(entries).filter(key => key.startsWith('.') && !key.includes('*') && entries[key] !== null);
	}

	#target(target: Target, conditions: Set<string>, via: string[]): string | null | undefined {
		if (typeof target === 'string' || target === null) return target;
		if (target instanceof Array) {
			for (const candidate of target) {
				const resolved = this.#target(candidate, conditions, via);
				if (typeof resolved === 'string') return resolved;
			}
			return;
		}
		if (!target || typeof target !== 'object') return;

		for (const [condition, value] of Object.entries(target)) {
			if (!conditions.has(condition)) continue;
			const trail = via.concat(condition);
			const resolved = this.#target(value, conditions, trail);
			if (resolved === void 0) continue;
			via.splice(0, via.length, ...trail);
			return resolved;
		}
	}

	#match(entries: Record<string, Target>, subpath: string): { target: Target; star?: string } | undefined {
		if (Object.prototype.hasOwnProperty.call(entries, subpath)) return { target: entries[subpath] };

		// The longest matching pattern wins, as in Node
		const patterns = Object.keys(entries)
			.filter(key => key.split('*').length === 2)
			.sort((a, b) => b.indexOf('*') - a.indexOf('*'));
		for (const pattern of patterns) {
			const [prefix, suffix] = pattern.split('*');
			if (!subpath.startsWith(prefix) || !subpath.endsWith(suffix) || subpath.length < pattern.length - 1) continue;
			return { target: entries[pattern], star: subpath.slice(prefix.length, subpath.length - suffix.length) };
		}
	}

	#legacy(subpath: string, platform: string): IResolvedExport {
		if (subpath !== '.') return { target: subpath, via: ['file'], diagnostics: [] };

		const { browser, module, main } = this.#manifest;
		const fields: [string, unknown][] = [['module', module], ['main', main]];
		platform !== 'node' && fields.unshift(['browser', browser]);

		const found = fields.find(([, value]) => typeof value === 'string' && value);
		const target = found ? <string>found[1] : './index.js';
		return { target: target.startsWith('.') ? target : `./${target}`, via: [found ? found[0] : 'index'], diagnostics: [] };
	}

	/**
	 * @param subpath `.` or `./name`
	 * @param platform `node`, or any other value for a browser
	 */
	resolve(subpath: string, platform: string, environment?: string): IResolvedExport {
		const entries = this.#entries;
		if (!entries) return this.#legacy(subpath, platform);

		const fail = (code: string, message: string): IResolvedExport => ({ via: [], diagnostics: [{ code, message }] });
		const label = `${this.name}${subpath === '.' ? '' : subpath.slice(1)}`;

		const matched = this.#match(entries, subpath);
		if (!matched || matched.target === null) {
			return fail('EXPORT_NOT_FOUND', `Package "${this.name}" does not export "${subpath}". Its "exports" field defines everything it publishes`);
		}

		const active = Exports.conditions(platform, environment);
		let via: string[] = [];
		let target = this.#target(matched.target, new Set(active), via);
		if (typeof target !== 'string') {
			// A package that only publishes CommonJS targets is still consumable: its output is adapted
			via = [];
			target = this.#target(matched.target, new Set(active.concat('require')), via);
		}
		if (typeof target !== 'string') {
			const message = `"${label}" has no target for the conditions ${active.join(', ')}. Add a "default" target to the package, or request conditions it declares`;
			return fail('EXPORT_CONDITIONS_UNMATCHED', message);
		}

		target = matched.star === void 0 ? target : target.split('*').join(matched.star);
		if (!target.startsWith('./') || target.split('/').includes('..') || target.includes('/node_modules/')) {
			return fail('EXPORT_TARGET_INVALID', `"${label}" resolves to "${target}", which is not a file of the package`);
		}
		return { target, via, diagnostics: [] };
	}
}
