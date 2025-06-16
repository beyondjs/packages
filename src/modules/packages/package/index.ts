import type { Info, LocatorError } from '../locator';
import type { PackageStore } from './store/interface';

let store: PackageStore;

export class Package {
	#specifier: string;

	constructor(specifier: string) {
		this.#specifier = specifier;
	}

	static async load(env: 'local' | 'cdn') {
		store = (await import(`./store/${env}`)) as { default: PackageStore };
	}

	async install(): Promise<void> {
		const info = await store.locate(this.#specifier);
		if ('error' in info) throw new Error(info.error.text);

		const exists = await store.exists(info);
		if (exists) return;

		const Downloader = (await import('../downloader')).default;
		const downloader = new Downloader(info);
		await downloader.install();

		await store.save(info);
	}
}
