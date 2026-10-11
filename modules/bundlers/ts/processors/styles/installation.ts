import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

/**
 * The packages of the toolchain's own installation, found the way this implementation loads them.
 *
 * A name is resolved with `import.meta.resolve`, which asks the loader that loaded this module: it resolves where
 * this module's own `import('tailwindcss')` does, the installation of the toolchain, whatever directory the
 * process works in and wherever the package being compiled was extracted. A confined compilation reads
 * Tailwind's stylesheets and loads a pinned plugin from there, and from nowhere else.
 */
export class Installation {
	/**
	 * The file a specifier resolves to for this implementation, or undefined when it resolves to no file
	 */
	static resolve(specifier: string): string | undefined {
		try {
			const url = (<{ resolve?(specifier: string): string }>(<unknown>import.meta)).resolve?.(specifier);
			return url?.startsWith('file:') ? fileURLToPath(url) : void 0;
		} catch {
			return void 0;
		}
	}

	/**
	 * The root directory of an installed package, or undefined when the toolchain does not install it
	 */
	static root(name: string): string | undefined {
		const entry = Installation.resolve(`${name}/package.json`) ?? Installation.resolve(name);
		for (let directory = entry && dirname(entry); directory && directory !== dirname(directory); directory = dirname(directory)) {
			if (Installation.#names(join(directory, 'package.json'), name)) return directory;
		}
	}

	static #names(manifest: string, name: string): boolean {
		try {
			return JSON.parse(readFileSync(manifest, 'utf8')).name === name;
		} catch {
			return false;
		}
	}
}
