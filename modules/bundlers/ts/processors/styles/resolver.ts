import type { IDiagnostic } from '@beyond-js/packages/types';
import { Confinement } from '@beyond-js/packages/confinement';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import { existsSync } from 'fs';
import { dirname, isAbsolute, join, resolve } from 'path';
import { Installation } from './installation';

/**
 * Where the stylesheets and the modules a Tailwind stylesheet names are, for one compilation.
 *
 * Not confined, a stylesheet is a relative path from the importing base, or a stylesheet of an installed
 * package (`tailwindcss`, `tailwindcss/theme.css`, the `index.css` of a plugin) resolved from the package of
 * the module first, then from the installation that runs Packages; a plugin or a configuration is imported
 * from where Node resolves it, starting at the importing base.
 *
 * Confined, nothing the package supplies runs and nothing outside it is read. A relative stylesheet is read
 * only when its real location is inside the package or inside a package the toolchain pins; an absolute path
 * is never read; a stylesheet of another package is one of `STYLESHEETS`, resolved from the toolchain's own
 * [Installation](./installation.ts), where this implementation loads Tailwind from, and never from the package
 * or the working directory. A configuration is never loaded, and a plugin only when it is one of `PLUGINS` and
 * that installation includes it. What is refused is kept in `refused`, by the name the stylesheet wrote.
 */
export class Resolver {
	/**
	 * The packages whose stylesheets a confined compilation reads, from the installation of the toolchain
	 */
	static STYLESHEETS = ['tailwindcss'];

	/**
	 * The first-party Tailwind plugins a confined compilation loads when the installation of the toolchain
	 * includes them. It includes none of them today, so every `@plugin` of a confined compilation is refused.
	 */
	static PLUGINS = ['@tailwindcss/typography', '@tailwindcss/forms', '@tailwindcss/aspect-ratio'];

	/**
	 * Where a stylesheet of an installed package is also looked for when the compilation is not confined: the
	 * directory Packages was started from, which in an installation is the toolchain
	 */
	static get #installation(): string {
		return join(process.cwd(), 'noop.js');
	}

	#package: string;
	#confinement?: Confinement;

	#refused: IDiagnostic[] = [];
	get refused(): IDiagnostic[] {
		return [...this.#refused];
	}

	/**
	 * @param pkg The package directory, which a stylesheet or a plugin is resolved from when not confined
	 * @param confinement The rules of a confined compilation of the package
	 */
	constructor(pkg: string, confinement?: Confinement) {
		this.#package = pkg;
		if (!confinement) return;

		// The stylesheets of the pinned packages are read where the toolchain installs them
		const pinned = Resolver.STYLESHEETS.map(name => Installation.root(name)).filter(Boolean);
		this.#confinement = new Confinement([...confinement.roots, ...pinned]);
	}

	/**
	 * The root of an installed package, resolved from the first location that installs it
	 */
	#root(name: string, from: string[]): string | undefined {
		for (const location of from) {
			try {
				return dirname(createRequire(pathToFileURL(location).href).resolve(`${name}/package.json`));
			} catch {
				// Not installed there, or its manifest is not exported: the next location is tried
			}
		}
	}

	#refuse(diagnostic: IDiagnostic): never {
		this.#refused.push(diagnostic);
		throw new Error(diagnostic.message);
	}

	/**
	 * The file of a stylesheet a stylesheet imports, or undefined when it does not exist
	 *
	 * @throws When a confined compilation refuses it
	 */
	stylesheet(id: string, base: string): string | undefined {
		const confinement = this.#confinement;
		const scheme = /^[a-z][a-z0-9+.-]*:/i.test(id);
		if (confinement && (scheme || isAbsolute(id))) this.#refuse(Confinement.source(id, 'a stylesheet'));

		if (id.startsWith('.') || isAbsolute(id)) {
			const file = resolve(base, id);
			if (confinement && !confinement.contains(file)) this.#refuse(Confinement.source(id, 'a stylesheet'));
			if (!existsSync(file)) return;
			if (confinement && !confinement.inside(file)) this.#refuse(Confinement.source(id, 'a stylesheet'));
			return file;
		}

		const segments = id.split('/');
		const name = segments.splice(0, id.startsWith('@') ? 2 : 1).join('/');
		const subpath = segments.join('/') || 'index.css';

		// Confined, a pinned package is read from the toolchain's installation alone
		if (confinement) {
			if (!Resolver.STYLESHEETS.includes(name)) this.#refuse(Confinement.source(id, 'a stylesheet'));
			const root = Installation.root(name);
			const file = root && join(root, subpath);
			if (file && !Confinement.within(root, file)) this.#refuse(Confinement.source(id, 'a stylesheet'));
			if (!file || !existsSync(file)) return;
			if (!confinement.inside(file)) this.#refuse(Confinement.source(id, 'a stylesheet'));
			return file;
		}

		// Otherwise the package of the module first, then the directory Packages was started from
		for (const location of [join(this.#package, 'noop.js'), Resolver.#installation]) {
			const root = this.#root(name, [location]);
			const file = root && join(root, subpath);
			if (file && existsSync(file)) return file;
		}
	}

	/**
	 * A plugin or a configuration a stylesheet names (`@plugin`, `@config`), imported
	 *
	 * @throws When it cannot be resolved, or a confined compilation refuses it
	 */
	async module(id: string, base: string, hint: 'plugin' | 'config'): Promise<{ path: string; module: unknown }> {
		const kind = hint === 'config' ? 'Tailwind configuration' : 'Tailwind plugin';
		if (this.#confinement && (hint === 'config' || !Resolver.PLUGINS.includes(id))) this.#refuse(Confinement.plugin(kind, id));

		let path: string;
		if (this.#confinement) {
			// A pinned plugin is the one the toolchain installs, never one the package carries
			path = Installation.resolve(id);
			!path && this.#refuse(Confinement.plugin(`${kind} (not installed with the toolchain)`, id));
		} else path = createRequire(join(base, 'noop.js')).resolve(id, { paths: [base, this.#package] });

		const imported = await import(pathToFileURL(path).href);
		return { path, module: imported.default ?? imported };
	}
}
