import type { PackageIdentifier } from '@beyond-js/packages/repositories/types';
import { db } from '@beyond-js/packages/persistence/db';
import { PackageInstaller } from './installer';

export /*bundle*/ class Package {
	#identifier: PackageIdentifier;

	constructor(identifier: PackageIdentifier) {
		this.#identifier = identifier;
	}

	async install(): Promise<void> {
		const info = await db.packages.get({ id: this.#identifier });
		if (info.exists) return;

		const installer = new PackageInstaller(this.#identifier);
		await installer.install();

		// await packages.set(info);
	}
}
