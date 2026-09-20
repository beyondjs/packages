import type { Plugin, PluginBuild, OnResolveArgs } from 'esbuild';
import { existsSync, realpathSync } from 'fs';
import { isAbsolute, relative, resolve, sep } from 'path';

/**
 * A static file the sources of a module use, by its path inside the package
 */
export /*bundle*/ interface IResource {
	/**
	 * The path relative to the package root, with forward slashes: the path of its `/assets/` address
	 */
	path: string;

	/**
	 * The file on disk
	 */
	file: string;

	/**
	 * Whether a stylesheet (`url()`) or a source import uses it
	 */
	via: 'css' | 'js';
}

const EXTENSIONS = /\.(svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|eot|wasm|txt)$/i;

/**
 * Keeps the static files a module uses as references instead of inlining or renaming them.
 *
 * A `url()` of a stylesheet and a source import of an image, a font or another static file resolve to the
 * file inside the package. The output addresses it relatively, from where the module or its stylesheet is
 * served (`…/modules/<subpath>`, `…/styles/<subpath>`) to `…/assets/<path in the package>`, so the same
 * output works on every origin that follows the compiled-module contract. Every file is recorded, which
 * is what lets an inventory list it and a service deliver it. A file outside the package, or one that does
 * not exist, is a build error.
 */
export /*bundle*/ class Resources implements Plugin {
	get name() {
		return 'beyond-resources';
	}

	#root: string;
	#prefix: string;

	#found: Map<string, IResource> = new Map();
	get found(): IResource[] {
		return [...this.#found.values()].sort((a, b) => a.path.localeCompare(b.path));
	}

	/**
	 * @param root The root of the package
	 * @param subpath The public subpath of the module (`.`, `./widget`), which decides how far `assets/` is
	 */
	constructor(root: string, subpath: string) {
		this.#root = realpathSync(root);
		const depth = subpath === '.' ? 1 : subpath.replace(/^\.\//, '').split('/').length;
		this.#prefix = '../'.repeat(depth) + 'assets/';
	}

	#locate(args: OnResolveArgs): { resource?: IResource; error?: string } {
		const clean = args.path.replace(/[?#].*$/, '');
		const file = isAbsolute(clean) ? clean : resolve(args.resolveDir, clean);
		if (!existsSync(file)) return { error: `The static file "${args.path}" does not exist` };

		const path = relative(this.#root, realpathSync(file));
		if (path.startsWith('..') || isAbsolute(path)) return { error: `The static file "${args.path}" is outside the package` };

		const via = args.kind === 'url-token' ? 'css' : 'js';
		const resource = { path: path.split(sep).join('/'), file, via: <'css' | 'js'>via };
		!this.#found.has(resource.path) && this.#found.set(resource.path, resource);
		return { resource };
	}

	setup = (build: PluginBuild) => {
		build.onResolve({ filter: /.*/ }, (args: OnResolveArgs) => {
			const token = args.kind === 'url-token';
			if (!token && !(EXTENSIONS.test(args.path) && /^\.\.?\//.test(args.path))) return;
			if (/^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(args.path)) return { path: args.path, external: true };

			const { resource, error } = this.#locate(args);
			if (error) return { errors: [{ text: error }] };

			const suffix = args.path.match(/[?#].*$/)?.[0] ?? '';
			const reference = this.#prefix + resource.path.split('/').map(encodeURIComponent).join('/') + suffix;
			return token ? { path: reference, external: true } : { path: reference, namespace: 'beyond-asset' };
		});

		build.onLoad({ filter: /.*/, namespace: 'beyond-asset' }, ({ path }) => {
			return { contents: `export default new URL(${JSON.stringify(path)}, import.meta.url).href;\n`, loader: 'js' };
		});
	};
}
