import * as crc32 from 'buffer-crc32';
import * as stringify from 'json-stable-stringify';

/**
 * Represents a structured way to handle package dependencies from a `package.json` file.
 * It maps each dependency to an object containing the version and type ('main', 'development', 'peer') of the dependency.
 */
export /*bundle*/ class DependenciesSpecs extends Map<string, { version: string; kind: string }> {
	#hash?: string;

	/**
	 * Gets the CRC32 hash of the serialized dependency map.
	 */
	getHash(): string | undefined {
		return this.#hash;
	}

	/**
	 * Generates and sets the CRC32 hash for the current state of the dependency map.
	 */
	private setHash(): void {
		const compute: Record<string, { version: string; kind: string }> = {};
		this.forEach((value, key) => {
			compute[key] = { version: value.version, kind: value.kind };
		});
		this.#hash = crc32(stringify(compute)).toString('hex');
	}

	/**
	 * Initializes the dependency map from a `package.json` structure.
	 * @param json The JSON object from a `package.json` file containing dependencies, devDependencies, and peerDependencies.
	 */
	constructor(json?: {
		dependencies?: Record<string, string>;
		devDependencies?: Record<string, string>;
		peerDependencies?: Record<string, string>;
	}) {
		super();
		if (json) {
			this.#set(json);
		}
	}

	/**
	 * Sets dependencies into the map from the provided JSON object.
	 * @param json The JSON object containing the dependencies to set.
	 */
	#set(json: {
		dependencies?: Record<string, string>;
		devDependencies?: Record<string, string>;
		peerDependencies?: Record<string, string>;
	}): void {
		const process = (dependency: string, version: string, kind: 'main' | 'development' | 'peer') =>
			this.set(dependency, { version, kind });
		const { dependencies: main, devDependencies: development, peerDependencies: peer } = json;

		main && Object.entries(main).forEach(entry => process(entry[0], entry[1], 'main'));
		development && Object.entries(development).forEach(entry => process(entry[0], entry[1], 'development'));
		peer && Object.entries(peer).forEach(entry => process(entry[0], entry[1], 'peer'));

		this.setHash();
	}

	/**
	 * Rehydrates the map with an array of key-value pairs.
	 * @param values An array of objects with `key` and `value` properties to set in the map.
	 */
	public hydrate(values: { key: string; value: { version: string; kind: string } }[]): void {
		this.clear();
		values.forEach(({ key, value }) => this.set(key, value));
		this.setHash();
	}

	/**
	 * Converts the map to a JSON-friendly format.
	 * This method is useful for serialization purposes, like storing in a database.
	 */
	public toJSON(): { key: string; value: { version: string; kind: string } }[] {
		return Array.from(this.entries()).map(([key, value]) => ({ key, value }));
	}
}
