import { valid } from 'semver';

/**
 * A public module named from the command line or by a development client.
 *
 * A selector is a public identity, never a file: `@example/app/main` is the `main` module of the package
 * `@example/app`, and `./main` is the same module named from inside that package. An exact version,
 * `@example/app@1.0.0/main`, asserts which version the local package has; it selects nothing else, so
 * ranges have no meaning here.
 *
 * | Selector | Package | Subpath |
 * | --- | --- | --- |
 * | `@example/app/main` | `@example/app` | `./main` |
 * | `@example/app@1.0.0/utils/text` | `@example/app`, version `1.0.0` | `./utils/text` |
 * | `app` | `app` | `.` |
 * | `./main` | the current package | `./main` |
 * | `.` | the current package | `.` |
 */
export /*bundle*/ class Selector {
	#input: string;
	get input() {
		return this.#input;
	}

	#error: { code: string; message: string };

	/**
	 * Why the input is not a selector, when it is not
	 */
	get error() {
		return this.#error;
	}

	get valid() {
		return !this.#error;
	}

	#local = false;

	/**
	 * Whether the selector names a module of the current package instead of naming its package
	 */
	get local() {
		return this.#local;
	}

	#name: string;
	get name() {
		return this.#name;
	}

	#version: string;
	get version() {
		return this.#version;
	}

	#subpath: string;
	get subpath() {
		return this.#subpath;
	}

	constructor(input: string) {
		this.#input = input;
		if (typeof input !== 'string' || !input.trim()) {
			return void this.#fail('SELECTOR_INVALID', 'The selector is empty');
		}

		const invalid = (path: string) =>
			path.split('/').some(part => !part || part === '.' || part === '..') || /[\\?#]/.test(path);

		if (input === '.' || input.startsWith('./')) {
			this.#local = true;
			this.#subpath = input === '.' ? '.' : input.replace(/\/+$/, '');

			const subpath = this.#subpath.slice(2);
			input !== '.' && invalid(subpath) && this.#fail('SELECTOR_INVALID', `"${input}" is not a module subpath`);
			return;
		}
		if (input.startsWith('.') || input.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(input)) {
			const message =
				`"${input}" is a path. A selector names a public module, ` +
				`such as @scope/package/module or ./module`;
			return void this.#fail('SELECTOR_INVALID', message);
		}

		const parts = input.split('/');
		const scope = parts[0].startsWith('@') ? parts.shift() : void 0;
		const [name, version, ...rest] = (parts.shift() ?? '').split('@');
		if (!name || rest.length || (scope && scope.length < 2) || (parts.length && invalid(parts.join('/')))) {
			return void this.#fail('SELECTOR_INVALID', `"${input}" is not a public module specifier`);
		}

		this.#name = scope ? `${scope}/${name}` : name;
		this.#subpath = parts.length ? `./${parts.join('/')}` : '.';

		if (version === void 0) return;
		if (!valid(version)) {
			const message =
				`"${version}" is not an exact version. A selector version asserts the version of the local package; ` +
				`ranges and tags are not supported`;
			return void this.#fail('SELECTOR_VERSION_UNSUPPORTED', message);
		}
		this.#version = version;
	}

	#fail(code: string, message: string): void {
		this.#error = { code, message };
	}
}
