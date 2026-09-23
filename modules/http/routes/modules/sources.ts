import { type Delivery, Installed } from '@beyond-js/packages/artifacts';
import { type Identity, ContractError } from '@beyond-js/artifact-api';
import { type IOrigin, Origins } from '../origins';

/**
 * Which source a development service delivers a package from, and whether a request names it.
 *
 * A package of the workspace, or one the toolchain supplies, belongs to no registry and is written unprefixed.
 * An installed package is addressed by the registry its lockfile recorded (`Origins`): unprefixed for npm, and
 * `/m/<registry id>/…` for any other registry. A request that names another source than the one the package
 * came from addresses nothing this service holds, which is `PACKAGE_NOT_FOUND`, so one path never delivers two
 * packages. Git and digest sources are not delivered by a development service: `SOURCE_UNSUPPORTED`.
 */
export /*bundle*/ class Sources {
	#delivery: Delivery;

	#origins = new Origins();
	get origins() {
		return this.#origins;
	}

	constructor(delivery: Delivery) {
		this.#delivery = delivery;
	}

	/**
	 * The registry id this service writes for a package at an exact version, or why it has none. A package the
	 * workspace contains, or one that is not installed, is written unprefixed.
	 */
	async origin(name: string, version: string): Promise<IOrigin> {
		const published = await this.#delivery.published();
		if (published.some(module => module.name === name && module.version === version)) return { registry: Origins.NPM };

		const root = this.#delivery.installed?.locate(name, version);
		return root ? this.#origins.installed(root, name) : { registry: Origins.NPM };
	}

	/**
	 * Whether a package is installed, at any version, from a registry: what tells an unknown version of a known
	 * package from an unknown package
	 */
	async #installed(name: string, registry: string): Promise<boolean> {
		const bases = new Set([...(await this.#delivery.published()).map(module => module.path), process.cwd()]);
		for (const base of bases) {
			const root = Installed.root(name, base);
			if (root && (await this.#origins.installed(root, name)).registry === registry) return true;
		}
		return false;
	}

	/**
	 * Checks that the source a request names is the one this service delivers the package from. A request of
	 * the npm registry for a package this service does not hold is left to the delivery, which tells an unknown
	 * package, version and module apart.
	 *
	 * @throws ContractError SOURCE_UNSUPPORTED for a git or digest source or a package installed from neither,
	 * PACKAGE_NOT_FOUND or VERSION_MISMATCH for a registry the package was not installed from
	 */
	async admit(identity: Identity): Promise<void> {
		const source = (<{ source?: string }>(<unknown>identity)).source ?? 'registry';
		if (source !== 'registry') {
			throw new ContractError('SOURCE_UNSUPPORTED', `A development service delivers the workspace and registry packages; "${source}" sources are not served`);
		}

		const { registry, name, version } = identity;
		const published = await this.#delivery.published();
		if (published.some(module => module.name === name)) {
			if (registry === Origins.NPM) return;
			throw new ContractError('PACKAGE_NOT_FOUND', `"${name}" is a package of the workspace, which belongs to no registry: it is addressed as /m/${name}@<version>/…`);
		}

		const root = this.#delivery.installed?.locate(name, version);
		if (!root) {
			if (registry === Origins.NPM) return;
			const known = await this.#installed(name, registry);
			throw new ContractError(known ? 'VERSION_MISMATCH' : 'PACKAGE_NOT_FOUND', `"${name}@${version}" is not installed from registry "${registry}"`);
		}

		const origin = await this.#origins.installed(root, name);
		if (origin.registry === registry) return;
		if (!origin.registry) throw new ContractError('SOURCE_UNSUPPORTED', `"${name}@${version}" has no registry address: ${origin.reason}`);

		const actual = origin.registry === Origins.NPM ? `/m/${name}@${version}/…` : `/m/${origin.registry}/${name}@${version}/…`;
		throw new ContractError('PACKAGE_NOT_FOUND', `"${name}@${version}" was not installed from ${registry === Origins.NPM ? 'the npm registry' : `registry "${registry}"`}: it is addressed as ${actual}`);
	}
}
