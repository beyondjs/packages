import type { Files } from './files';
import { posix } from 'path';

/**
 * The extensions the compiler reads types from
 */
const TYPED = /\.(d\.ts|d\.mts|d\.cts|ts|tsx|mts|cts)$/;

/**
 * Selects the file that describes the types of a public subpath of a package, from the package manifest.
 *
 * A package of Beyond sources publishes its entry points as `exports` targets, so the source itself is the
 * description of its types. A compiled package declares them with the `types` condition, with a declaration
 * next to the JavaScript target, or with the `types` field of the manifest. `typesVersions` is not read.
 */
export class Exports {
	#files: Files;
	#conditions: Set<string>;

	/**
	 * @param files What the check may read
	 * @param conditions The conditions of the request, tried after `types` and before `import` and `default`
	 */
	constructor(files: Files, conditions: string[]) {
		this.#files = files;
		this.#conditions = new Set(['types', ...conditions, 'import', 'module', 'default']);
	}

	/**
	 * @param directory The absolute directory of the package
	 * @param subpath The requested subpath, such as `.` or `./message`
	 * @returns The absolute file that describes the types, or undefined when the package declares none
	 */
	types(directory: string, subpath: string): string | undefined {
		const manifest = this.#files.json(`${directory}/package.json`);
		if (!manifest || typeof manifest !== 'object') return;

		const declared = manifest.exports;
		if (declared !== void 0 && declared !== null) {
			return this.#typed(directory, this.#target(this.#entry(declared, subpath)));
		}

		if (subpath !== '.') return this.#typed(directory, subpath);

		const types = manifest.types ?? manifest.typings;
		if (typeof types === 'string') return this.#typed(directory, types);
		return this.#typed(directory, typeof manifest.main === 'string' ? manifest.main : './index');
	}

	/**
	 * The `exports` entry that publishes a subpath, with its pattern applied
	 */
	#entry(declared: any, subpath: string): unknown {
		const map = typeof declared === 'object' && !Array.isArray(declared);
		const subpaths = map && Object.keys(declared).some(key => key.startsWith('.'));
		if (!subpaths) return subpath === '.' ? declared : void 0;
		if (subpath in declared) return declared[subpath];

		for (const [key, value] of Object.entries(declared)) {
			const [before, after, more] = key.split('*');
			if (after === void 0 || more !== void 0) continue;
			if (!subpath.startsWith(before) || !subpath.endsWith(after)) continue;
			if (subpath.length < before.length + after.length) continue;

			const matched = subpath.slice(before.length, subpath.length - after.length);
			return this.#expand(value, matched);
		}
	}

	/**
	 * Replaces the pattern of an entry in every target it declares
	 */
	#expand(value: unknown, matched: string): unknown {
		if (typeof value === 'string') return value.split('*').join(matched);
		if (Array.isArray(value)) return value.map(one => this.#expand(one, matched));
		if (!value || typeof value !== 'object') return value;

		const entries = Object.entries(value).map(([key, one]) => [key, this.#expand(one, matched)]);
		return Object.fromEntries(entries);
	}

	/**
	 * The first target of an entry that the conditions select
	 */
	#target(entry: unknown): string | undefined {
		if (typeof entry === 'string') return entry;
		if (!entry || typeof entry !== 'object') return;

		if (Array.isArray(entry)) {
			for (const one of entry) {
				const target = this.#target(one);
				if (target) return target;
			}
			return;
		}

		for (const [condition, value] of Object.entries(entry)) {
			if (!this.#conditions.has(condition)) continue;
			const target = this.#target(value);
			if (target) return target;
		}
	}

	/**
	 * The existing file that types a target: the target itself when the compiler reads it, or the
	 * declaration or source published next to a JavaScript target
	 */
	#typed(directory: string, target?: string): string | undefined {
		if (!target) return;

		const file = posix.join(directory, target);
		if (file !== directory && !file.startsWith(`${directory}/`)) return;
		if (TYPED.test(file)) return this.#files.exists(file) ? file : void 0;

		const script = file.match(/^(.*)\.([mc]?)js$/);
		const candidates = script
			? [`${script[1]}.d.${script[2]}ts`, `${script[1]}.ts`, `${script[1]}.tsx`]
			: ['.d.ts', '.ts', '.tsx', '/index.d.ts', '/index.ts', '/index.tsx'].map(extension => file + extension);
		return candidates.find(candidate => this.#files.exists(candidate));
	}
}
