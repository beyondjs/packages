import type { Info } from '../locator';
import type { PackageStore } from './store/interface';

let store: PackageStore;

export /*bundle*/ class Packages {
	static async load(env: 'local' | 'cdn') {
		store = (await import(`./store/${env}`)) as { default: PackageStore };
	}

	static async all(): Promise<Info[]> {
		return await store.all();
	}

	static async get(specifier: string): Promise<Info | undefined> {
		return await store.get(specifier);
	}
}
