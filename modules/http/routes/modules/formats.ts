import { ContractError } from '@beyond-js/artifact-api';
import { SystemFormat } from '@beyond-js/packages/generation';

/**
 * The module formats this service answers: the ES module the delivery compiles, and the same module as a
 * `System.register` module for `format=system`.
 *
 * The conversion is Packages' own `SystemFormat`, the one the CDN generation uses: a module-format
 * transformation of the one file a public module compiles to, so nothing is compiled again and a composed
 * module keeps registering itself in its runtime exactly as its ES module does. Its source map is composed with
 * the one of the compiler and travels inline, as the development map of the ES module does. A converted module
 * is kept by the hash of the code it came from, so a request that does not change the bytes does not convert
 * them again.
 */
export class Formats {
	static FORMATS = ['esm', 'system'];

	static #LIMIT = 256;
	static #INLINE = /\n?\/\/# sourceMappingURL=data:application\/json;(?:charset=[^;,]+;)?base64,([A-Za-z0-9+/=]+)\s*$/;

	#system = new SystemFormat();
	#converted: Map<string, string> = new Map();

	/**
	 * Splits an ES module from its inline source map
	 */
	static #split(code: string): { body: string; map?: string } {
		const match = Formats.#INLINE.exec(code);
		if (!match) return { body: code };
		return { body: code.slice(0, match.index), map: Buffer.from(match[1], 'base64').toString('utf8') };
	}

	/**
	 * The code of a module in the requested format
	 *
	 * @param code The ES module, with its source map inline or none
	 * @param format `esm` or `system`
	 * @param key What identifies the bytes of `code`: the hash of the artifact and the form of its map
	 * @throws ContractError BUILD_FAILED when the ES module cannot be written as a `System.register` module
	 */
	code(code: string, format: string, key: string): string {
		if (format !== 'system') return code;
		const cached = this.#converted.get(key);
		if (cached !== void 0) return cached;

		const { body, map } = Formats.#split(code);
		const converted = this.#system.transform(body, map);
		if (!converted.code) {
			const message = `The module cannot be written as a System.register module: ${converted.diagnostics[0]?.message}`;
			throw new ContractError('BUILD_FAILED', message, { diagnostics: converted.diagnostics.map(({ code, message }) => ({ code, message })) });
		}

		const inline = converted.map ? `//# sourceMappingURL=data:application/json;charset=utf-8;base64,${Buffer.from(converted.map).toString('base64')}\n` : '';
		const result = `${converted.code.replace(/\n*$/, '\n')}${inline}`;
		if (this.#converted.size >= Formats.#LIMIT) this.#converted.delete(this.#converted.keys().next().value);
		this.#converted.set(key, result);
		return result;
	}
}
