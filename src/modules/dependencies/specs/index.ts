import Hash from './hash';

interface IDependencies {
	dependencies?: unknown;
	devDependencies?: unknown;
	peerDependencies?: unknown;
	optionalDependencies?: unknown;
	overrides?: Record<string, string | Record<string, string>>;
}

type Kind = 'main' | 'development' | 'peer' | 'optional';

const priority: Record<Kind, number> = {
	peer: 4,
	optional: 3,
	main: 2,
	development: 1
};

/**
 * Represents a structured list of dependencies from a `package.json`.
 * Maps each dependency name (key) to:
 * - an identifier (semver, git ref, URL, etc.)
 * - its kind: 'main', 'development', 'peer', or 'optional'
 *
 * Also stores:
 * - raw `overrides`
 * - a list of warnings if the input structure is invalid
 */
export /*bundle*/ class DependenciesSpecs extends Map<string, { identifier: string; kind: Kind }> {
	#hash?: Hash;
	get hash(): number {
		return this.#hash.value;
	}

	#overrides?: Record<string, string | Record<string, string>>;
	get overrides(): Record<string, string | Record<string, string>> | undefined {
		return this.#overrides;
	}

	#warnings: string[] = [];
	get warnings(): string[] {
		return this.#warnings;
	}

	constructor(json: IDependencies) {
		super();

		const add = (name: string, value: string, kind: Kind) => {
			const current = this.get(name);
			if (!current || priority[kind] > priority[current.kind]) {
				this.set(name, { identifier: value, kind });
			}
		};

		const read = (group: unknown, name: string, kind: Kind) => {
			// Skip undefined or null groups silently (valid case)
			if (group === void 0 || group === null) return;

			// Warn if the group is not a plain object
			if (typeof group !== 'object' || Array.isArray(group)) {
				this.#warnings.push(
					`"${name}" is not a valid object (got ${Array.isArray(group) ? 'array' : typeof group})`
				);
				return;
			}

			for (const [key, val] of Object.entries(group as Record<string, unknown>)) {
				if (typeof val !== 'string') {
					this.#warnings.push(`Invalid value for "${key}" in "${name}": expected string, got ${typeof val}`);
					continue;
				}
				add(key, val, kind);
			}
		};

		read(json.dependencies, 'dependencies', 'main');
		read(json.devDependencies, 'devDependencies', 'development');
		read(json.peerDependencies, 'peerDependencies', 'peer');
		read(json.optionalDependencies, 'optionalDependencies', 'optional');

		this.#overrides = json.overrides;

		this.#hash = new Hash(this);
		this.#hash.update();
	}
}
