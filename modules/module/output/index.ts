import { createHash } from 'crypto';

export type CodeOutputType = 'raw-code' | 'sourcemap-inline';

export type MapType = 'string' | 'object' | 'base64';

/**
 * The code and the source map of one output of a conditional.
 *
 * An output without code (a module whose sources produce only a stylesheet, a processing that failed) answers
 * `undefined` for its code and its hash, and never throws: a conditional reads its outputs while it processes,
 * and a throw there would leave its readiness, and every request waiting for it, unsettled.
 */
export /*bundle*/ class ConditionalOutput {
	#code: Map<'sourcemap-inline' | 'raw-code', any>;
	code(output?: CodeOutputType) {
		if (typeof this.#code?.get('raw-code') !== 'string') return;

		if (output === 'sourcemap-inline') {
			if (this.#code.has('sourcemap-inline')) return this.#code.get('sourcemap-inline');

			const base64 = this.map('base64');
			const inline = base64 ? `\n//# sourceMappingURL=data:application/json;base64,${base64}` : '';
			const code = this.#code.get('raw-code') + inline;
			this.#code.set('sourcemap-inline', code);
			return code;
		}

		return this.#code.get('raw-code');
	}

	#map: Map<MapType, string | Buffer | object>;
	map(format: MapType = 'string') {
		if (!this.#map) return;

		const decode64 = () => {
			if (!this.#map.has('base64')) throw new Error(`Map format 'base64' not found.`);

			const base64 = <string>this.#map.get('base64');
			const map = Buffer.from(base64, 'base64').toString('utf8');
			this.#map.set('string', map);
			return map;
		};

		if (format === 'string') {
			// Return the raw map if it exists
			if (this.#map.has('string')) return this.#map.get('string');

			// If the raw map does not exist, but an object map does, convert it to a string
			if (this.#map.has('object')) {
				const map = JSON.stringify(this.#map.get('object'));
				this.#map.set('string', map);
				return map;
			}

			// If map exists in base64 format, decode it
			if (this.#map.has('base64')) {
				return decode64();
			}
		} else if (format === 'object') {
			// Return the object map if it exists
			if (this.#map.has('object')) return this.#map.get('object');

			// If the object map does not exist, but a string map does, parse it
			// A map that is not JSON is no map
			const parse = (text: string) => {
				try {
					return JSON.parse(text);
				} catch {
					return void 0;
				}
			};
			if (this.#map.has('string')) {
				const map = parse(<string>this.#map.get('string'));
				map !== void 0 && this.#map.set('object', map);
				return map;
			}

			// If map exists in base64 format, decode it and parse
			if (this.#map.has('base64')) {
				const map = parse(decode64());
				map !== void 0 && this.#map.set('object', map);
				return map;
			}
		} else if (format === 'base64') {
			// Return the base64 map if it exists
			if (this.#map.has('base64')) return this.#map.get('base64');

			// If the base64 map does not exist, but a string map does, encode it
			if (this.#map.has('string')) {
				const raw = <string>this.#map.get('string');
				const base64 = Buffer.from(raw).toString('base64');
				this.#map.set('base64', base64);
				return base64;
			}

			// If map exists in object format, convert to string and then to base64
			if (this.#map.has('object')) {
				const raw = JSON.stringify(this.#map.get('object'));
				const base64 = Buffer.from(raw).toString('base64');
				this.#map.set('base64', base64);
				return base64;
			}
		} else {
			throw new Error(`Invalid map format '${format}'. Valid formats are: raw, object, base64.`);
		}
	}

	#hash: string | undefined;
	get hash() {
		if (this.#hash !== void 0) return this.#hash;
		if (typeof this.#code?.get('raw-code') !== 'string') return void 0;

		this.#hash = createHash('md5').update(this.#code.get('raw-code')).digest('hex');
		return this.#hash;
	}

	/**
	 * Sets the code and its map. A value that is not a string is no code, and a map that is neither a string nor
	 * an object is no map: they are left out rather than refused, because this runs inside a processing.
	 */
	set(values: { code?: string; map?: string | object }) {
		const { code, map } = values && typeof values === 'object' ? values : <{ code?: string; map?: string | object }>{};
		this.#code = new Map();
		typeof code === 'string' && this.#code.set('raw-code', code);

		this.#map = new Map();
		if (typeof map === 'string') {
			this.#map.set('string', map);
		} else if (typeof map === 'object' && map !== null) {
			this.#map.set('object', map);
		}

		this.#hash = void 0; // Reset hash when code or map changes
	}
}
