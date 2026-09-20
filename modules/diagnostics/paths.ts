import { homedir, tmpdir } from 'os';
import { isAbsolute, resolve } from 'path';

/**
 * The locations one check may read, and how they are named in a result.
 *
 * A check reads the package, the locations its caller supplied for the types of the dependencies and the
 * TypeScript default libraries, and nothing else: an import that leaves them is not followed. Whatever a
 * result names is relative to the package or replaced by a label, so a result never describes the host.
 */
export class Paths {
	#root: string;
	#labels: [string, string][] = [];

	/**
	 * The package directory, normalized
	 */
	get root(): string {
		return this.#root;
	}

	/**
	 * @param root The absolute directory of the package
	 */
	constructor(root: string) {
		this.#root = Paths.normalize(resolve(root));
	}

	/**
	 * Forward slashes and no trailing separator, which is how the compiler names files
	 */
	static normalize(file: string): string {
		const normalized = file.replace(/\\/g, '/');
		return normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized;
	}

	/**
	 * Whether a location supplied by the caller is usable
	 */
	static absolute(file: unknown): file is string {
		return typeof file === 'string' && !!file && isAbsolute(file);
	}

	/**
	 * Allows reading under a location, which results name with the given label
	 */
	allow(location: string, label: string): void {
		this.#labels.push([Paths.normalize(resolve(location)), label]);

		// The longest location is replaced first, so a nested one keeps its own label
		this.#labels.sort(([a], [b]) => b.length - a.length);
	}

	/**
	 * The absolute name of a file of the package, or undefined when the relative path leaves the package
	 */
	absolute(relative: string): string | undefined {
		if (typeof relative !== 'string' || !relative || isAbsolute(relative)) return;

		const file = Paths.normalize(resolve(this.#root, relative));
		return this.relative(file) === void 0 ? void 0 : file;
	}

	/**
	 * The name of a file relative to the package, or undefined when it is not in the package
	 */
	relative(file: string): string | undefined {
		file = Paths.normalize(file);
		if (file === this.#root) return '';
		return file.startsWith(`${this.#root}/`) ? file.slice(this.#root.length + 1) : void 0;
	}

	/**
	 * Whether the check may read a location
	 */
	allowed(file: string): boolean {
		file = Paths.normalize(file);
		if (this.relative(file) !== void 0) return true;
		return this.#labels.some(([location]) => file === location || file.startsWith(`${location}/`));
	}

	/**
	 * How a result names a file: relative to the package, or under the label of its location
	 */
	name(file: string): string {
		const relative = this.relative(file);
		return relative === void 0 ? this.clean(Paths.normalize(file)) : relative;
	}

	/**
	 * Removes the host locations from a text, such as a compiler message that quotes a file
	 */
	clean(text: string): string {
		let output = text.replace(/\\/g, '/');
		output = output.split(`${this.#root}/`).join('').split(this.#root).join('.');
		this.#labels.forEach(([location, label]) => (output = output.split(location).join(label)));

		// Locations the check never reads can still be quoted by a message that reports a failed lookup
		[process.cwd(), homedir(), tmpdir()].forEach(location => {
			const normalized = Paths.normalize(location);
			normalized.length > 1 && (output = output.split(normalized).join('<host>'));
		});
		return output;
	}
}
