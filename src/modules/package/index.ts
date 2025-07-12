import type { Packages } from '@beyond-js/packages/persistence/interfaces';
import { PackageInstaller } from './installer';

export /*bundle*/ class Package {
	#packages: Packages;

	/**
	 * A string identifier that indicates the exact source of the package.
	 * It will be passed to the Locator to resolve the package's download location.
	 *
	 * Examples:
	 *   - "package-name@1.2.3"
	 *   - "github:user/repo@1.0.0"
	 *   - "url:https://domain.com/package.tgz"
	 *   - "github-pkg:package-name@1.0.0"
	 */
	#identifier: string;

	constructor(identifier: string, tokens) {
		this.#identifier = identifier;
	}

	async initialize(env: 'local' | 'cdn') {
		if (this.#packages) return;

		const db = await import(`@beyond-js/packages/persistence/${env}/db`);
		this.#packages = db.packages;
	}

	async install(): Promise<void> {
		// const packages = this.#packages;
		// const info = await packages.get({ id: this.#identifier });
		// if (info.exists) return;

		const installer = new PackageInstaller(this.#identifier);
		await installer.install();

		// await packages.set(info);
	}
}
