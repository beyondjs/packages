import Hash from './hash';

interface IDependencies {
	dependencies?: unknown;
	devDependencies?: unknown;
	peerDependencies?: unknown;
	optionalDependencies?: unknown;
	peerDependenciesMeta?: unknown;
	overrides?: Record<string, string | Record<string, string>>;
}

export /*bundle*/ type DependencyKind = 'main' | 'development' | 'peer' | 'optional';

/**
 * The kind a name keeps when several groups declare it, as package managers install it: an optional
 * declaration replaces a regular one, and a regular one makes the package a dependency of its own even
 * if it is also declared as a peer.
 */
const priority: Record<DependencyKind, number> = {
	optional: 4,
	main: 3,
	peer: 2,
	development: 1
};

export /*bundle*/ interface IDependencySpec {
	version: string;
	kind: DependencyKind;
	// True for a peer that `peerDependenciesMeta` marks as optional
	optional?: boolean;
}

/**
 * Represents a structured list of dependencies from a `package.json`.
 * Maps each dependency name (key) to:
 * - a version (semver, git ref, URL, etc.)
 * - its kind: 'main', 'development', 'peer', or 'optional'
 *
 * Also stores:
 * - raw `overrides`
 * - a list of warnings if the input structure is invalid
 */
export /*bundle*/ class DependenciesSpec extends Map<string, IDependencySpec> {
	#hash?: Hash;
	get hash(): string {
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

		const add = (name: string, value: string, kind: DependencyKind) => {
			const current = this.get(name);
			if (!current || priority[kind] > priority[current.kind]) {
				this.set(name, { version: value, kind });
			}
		};

		const read = (group: unknown, name: string, kind: DependencyKind) => {
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

		// Peers marked optional are tolerated when nobody provides them
		const meta = json.peerDependenciesMeta;
		if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
			for (const [name, value] of Object.entries(meta as Record<string, { optional?: boolean }>)) {
				const current = this.get(name);
				if (current?.kind === 'peer' && value?.optional === true) current.optional = true;
			}
		}

		this.#overrides = json.overrides;

		this.#hash = new Hash(this);
		this.#hash.update();
	}
}
