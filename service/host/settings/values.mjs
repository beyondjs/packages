import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { isAbsolute, normalize } from 'node:path';

/**
 * The kinds of value a setting holds. Each one `parse`s what a request or the settings file gives (`{value}` with
 * `null` meaning the default, or `{message}` saying why the value is refused), reads the value an environment
 * variable gives (`environment`), and an `Executable` also `verify`s what only running it tells.
 */

/**
 * The origin of a CDN: https, or http on a loopback name (`localhost`, `*.localhost`, `127.x.x.x`, `[::1]`), with no
 * path, query, fragment or credentials
 */
export class Origin {
	static #LOOPBACK = /^(localhost|.+\.localhost|127(\.\d{1,3}){3}|\[::1\])$/i;

	parse(value) {
		if (value === null) return { value: null };
		const refused = { message: 'an origin is https, or http on a loopback name, such as "https://cdn.example.com" or "http://127.0.0.1:8080"' };
		if (typeof value !== 'string' || !value.trim() || value.length > 2048) return refused;

		let url;
		try {
			url = new URL(value.trim());
		} catch {
			return refused;
		}
		if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
			return { message: 'an origin has no path, query, fragment or credentials' };
		}
		if (url.protocol === 'https:' || (url.protocol === 'http:' && Origin.#LOOPBACK.test(url.hostname))) return { value: url.origin };
		return refused;
	}

	/**
	 * The origin as the preview reads `BEYOND_CDN_ORIGIN`
	 */
	environment(text) {
		return text.trim().replace(/\/+$/, '') || null;
	}
}

/**
 * A whole number of milliseconds within a range
 */
export class Milliseconds {
	#min;
	#max;

	constructor(min, max) {
		this.#min = min;
		this.#max = max;
	}

	parse(value) {
		if (value === null) return { value: null };
		if (!Number.isInteger(value) || value < this.#min || value > this.#max) {
			return { message: `a whole number of milliseconds from ${this.#min} to ${this.#max}` };
		}
		return { value };
	}

	environment(text) {
		const value = Number(text);
		return Number.isFinite(value) ? value : text;
	}
}

/**
 * The absolute path of a Deno 2 executable, which `verify` runs with `--version` within the bound of `Deno`
 */
export class Executable {
	#deno;

	/**
	 * @param {import('./deno.mjs').Deno} deno
	 */
	constructor(deno) {
		this.#deno = deno;
	}

	parse(value) {
		if (value === null) return { value: null };
		if (typeof value !== 'string' || !value || value.length > 4096 || value.includes('\0')) return { message: 'the absolute path of a Deno 2 executable' };
		if (!isAbsolute(value)) return { message: `"${value}" is not an absolute path` };
		return { value: normalize(value) };
	}

	/**
	 * @param {string | null} value A parsed value
	 * @returns {Promise<{message?: string}>} Why the executable is refused, nothing when it is Deno 2
	 */
	async verify(value) {
		if (value === null) return {};
		const found = await stat(value).catch(() => void 0);
		if (!found) return { message: `"${value}" does not exist` };
		if (!found.isFile()) return { message: `"${value}" is not a file` };
		const runnable = await access(value, constants.X_OK).then(() => true, () => false);
		if (!runnable) return { message: `"${value}" is not executable by the user of the service` };

		const checked = await this.#deno.check(value);
		return checked.version ? {} : { message: `"${value}" ${checked.message}` };
	}

	environment(text) {
		return text;
	}
}

/**
 * The variables given to a launched backend: an object of at most 50 names (`[A-Z_][A-Z0-9_]*`) whose values are
 * strings of at most 4096 characters; an empty object is the default.
 *
 * Names that configure the loader, the runtime or the toolchain are reserved (`Variables.reserved`: `LD_*`, `DYLD_*`,
 * `NODE_OPTIONS`, `NODE_PATH`, `BEE_*`, `BEYOND_*`, `DENO_*`): a change that names one is refused, and one the settings
 * file holds (`parse(value, {stored: true})`) is kept as written and never given to a target, which the launch says.
 */
export class Variables {
	static #NAME = /^[A-Z_][A-Z0-9_]*$/;
	static #RESERVED = /^(LD_|DYLD_|BEE_|BEYOND_|DENO_)|^(NODE_OPTIONS|NODE_PATH)$/;
	static LIMIT = 50;
	static LENGTH = 4096;

	/**
	 * Whether a variable name is reserved: it would change how the target is loaded or what the toolchain does
	 *
	 * @param {string} name
	 */
	static reserved(name) {
		return Variables.#RESERVED.test(name);
	}

	/**
	 * @param {unknown} value
	 * @param {{stored?: boolean}} [options] Whether the value is the one the settings file holds, whose reserved names
	 * are kept and ignored at the launch rather than refused
	 */
	parse(value, { stored = false } = {}) {
		if (value === null) return { value: null };
		if (!value || typeof value !== 'object' || Array.isArray(value)) return { message: 'an object of variables, such as {"PORT": "4000"}' };

		const entries = Object.entries(value);
		if (entries.length > Variables.LIMIT) return { message: `at most ${Variables.LIMIT} variables` };
		for (const [name, text] of entries) {
			if (!Variables.#NAME.test(name)) return { message: `"${name}" is not a variable name ([A-Z_][A-Z0-9_]*)` };
			if (!stored && Variables.reserved(name)) {
				return { message: `${name} is reserved: variables of the loader, the runtime and the toolchain (LD_*, DYLD_*, NODE_OPTIONS, NODE_PATH, BEE_*, BEYOND_*, DENO_*) are never given to a target` };
			}
			if (typeof text !== 'string') return { message: `the value of ${name} is not a string` };
			if (text.length > Variables.LENGTH || text.includes('\0')) return { message: `the value of ${name} is longer than ${Variables.LENGTH} characters or holds a NUL character` };
		}
		return { value: entries.length ? Object.fromEntries(entries) : null };
	}

	environment(text) {
		return text;
	}
}
