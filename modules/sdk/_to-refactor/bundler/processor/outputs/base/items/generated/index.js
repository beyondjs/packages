module.exports = class {
	#code;
	code(options) {
		if (!this.#code) return;

		const sourcemap = options?.sourcemap || false;
		if (sourcemap === 'inline') {
			if (this.#code.has('sourcemap')) return this.#code.get('sourcemap');

			const base64 = this.map('base64');
			const inline = base64 ? `\n//# sourceMappingURL=data:application/json;base64,${base64}` : '';
			const code = this.#code.get('raw') + inline;
			this.#code.set('sourcemap', code);
			return code;
		}

		return this.#code.get('raw');
	}

	#map;
	map(format) {
		if (!this.#map) return;

		format = format || 'raw';

		const decode64 = () => {
			if (!this.#map.has(base64)) throw new Error(`Map format '${base64}' not found.`);

			const base64 = this.#map.get('base64');
			const map = Buffer.from(base64, 'base64').toString('utf8');
			this.#map.set('raw', map);
			return map;
		};

		if (format === 'raw') {
			// Return the raw map if it exists
			if (this.#map.has('raw')) return this.#map.get('raw');

			// If the raw map does not exist, but an object map does, convert it to a string
			if (this.#map.has('object')) {
				const map = JSON.stringify(this.#map.get('object'));
				this.#map.set('raw', map);
				return map;
			}

			// If map exists in base64 format, decode it
			if (this.#map.has('base64')) {
				return decode64();
			}
		} else if (format === 'object') {
			// Return the object map if it exists
			if (this.#map.has('object')) return this.#map.get('object');

			// If the object map does not exist, but a raw map does, parse it
			if (this.#map.has('raw')) {
				const map = JSON.parse(this.#map.get('raw'));
				this.#map.set('object', map);
				return map;
			}

			// If map exists in base64 format, decode it and parse
			if (this.#map.has('base64')) {
				const raw = decode64();
				const map = JSON.parse(raw);
				this.#map.set('object', map);
				return map;
			}
		} else if (format === 'base64') {
			// Return the base64 map if it exists
			if (this.#map.has('base64')) return this.#map.get('base64');

			// If the base64 map does not exist, but a raw map does, encode it
			if (this.#map.has('raw')) {
				const raw = this.#map.get('raw');
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

	#exports;
	get exports() {
		return this.#exports;
	}

	#hash;
	get hash() {
		if (this.#hash !== void 0) return this.#hash;

		if (!this.#code) return (this.#hash = 0);

		this.#hash = crc32(`${this.#code}::${this.#map}`);
		return this.#hash;
	}

	set(values) {
		if (typeof values !== 'object') throw new Error('Invalid parameters');

		const { code, map, exports } = values;
		if (exports && !(exports instanceof Set)) {
			throw new Error('Invalid exports property. It must be a Set.');
		}

		this.#code = new Map();
		this.#code.set('raw', code);

		this.#map = new Map();
		if (typeof map === 'string') {
			this.#map.set('raw', map);
		} else if (typeof map === 'object' && map !== null) {
			this.#map.set('object', map);
		} else if (map) {
			throw new Error('Invalid map property. It must be a string or an object.');
		}

		this.#exports = exports ? exports : new Set();

		this.#hash = void 0; // Reset hash when code or map changes
	}
};
