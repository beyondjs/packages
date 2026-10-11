import type { Plugin, PluginBuild, OnResolveArgs, OnLoadArgs, Loader } from 'esbuild';
import { Confinement } from '@beyond-js/packages/confinement';
import { promises as fs } from 'fs';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'path';
import { Globs } from './globs';
import { Maps } from './maps';

/**
 * Keeps a build of untrusted sources inside its package.
 *
 * Every file the compiler reaches is named by a source: an import, a `require`, a CSS `@import` or `url()`,
 * a package-private `#import`, the entry point. Before the compiler resolves a name, an absolute path and a
 * relative path that leaves the package are refused, whether or not they exist; before it reads a file, the
 * real location of the file must be inside the package, which refuses a symbolic link whose target is
 * outside. Nothing refused is read, and each refusal is an error of the build that the bundle reports as
 * `SOURCE_CONFINED`.
 *
 * The compiler also reaches files without asking any plugin: the directories a pattern import expands to
 * ([Globs](./globs.ts)), and the input source maps a file names and the sources those maps name
 * ([Maps](./maps.ts)). A JavaScript or CSS file is therefore read here before the compiler parses it: one with
 * a pattern that leaves the package is refused, and one whose map would make the compiler read outside the
 * package is compiled without it.
 *
 * Bare specifiers never reach a file: the boundary keeps them as public references.
 */
export class Confined implements Plugin {
	get name() {
		return 'beyond-confined';
	}

	/**
	 * The loader the compiler gives a file it reads itself, for the files that can name a source map or hold
	 * a pattern import
	 */
	static LOADERS: Record<string, Loader> = {
		'.js': 'js',
		'.mjs': 'js',
		'.cjs': 'js',
		'.jsx': 'jsx',
		'.ts': 'ts',
		'.mts': 'ts',
		'.cts': 'ts',
		'.tsx': 'tsx',
		'.css': 'css'
	};

	#confinement: Confinement;
	#root: string;
	#globs: Globs;
	#maps: Maps;
	#refused: Set<string> = new Set();

	/**
	 * Whether an error of the build is a refusal of this plugin
	 */
	refused(text: string): boolean {
		return this.#refused.has(text);
	}

	/**
	 * @param root The root of the package, the only directory the build reads
	 */
	constructor(root: string) {
		this.#root = root;
		this.#confinement = new Confinement([root]);
		this.#globs = new Globs(this.#confinement);
		this.#maps = new Maps(this.#confinement);
	}

	#refuse(named?: string, by?: string) {
		const { message } = Confinement.source(named, by);
		this.#refused.add(message);
		return { errors: [{ text: message }] };
	}

	/**
	 * The importing file as the package names it
	 */
	#importer(importer: string): string | undefined {
		if (!importer || !this.#confinement.contains(importer)) return;
		return relative(this.#root, importer).split(sep).join('/');
	}

	#resolve = (args: OnResolveArgs) => {
		const path = args.path.replace(/[?#].*$/, '');
		const token = args.kind === 'url-token';
		const drive = /^[A-Za-z]:[\\/]/.test(path);

		// An address with a scheme, a protocol-relative URL of a stylesheet and a fragment name no file
		if (!drive && (/^[a-z][a-z0-9+.-]*:/i.test(path) || (token && /^(\/\/|#)/.test(args.path)))) return;

		const by = this.#importer(args.importer);
		if (isAbsolute(path) || drive) {
			// The entry point is named by whoever prepares the package, from inside it
			if (args.kind === 'entry-point' && this.#confinement.contains(path)) return;
			return this.#refuse(args.path, by);
		}

		if (/^\.\.?([\\/]|$)/.test(path)) {
			const base = args.resolveDir || (args.importer && dirname(args.importer));
			if (base && !this.#confinement.contains(resolve(base, path))) return this.#refuse(args.path, by);
		}
	};

	/**
	 * The loader the compiler would give a file it reads itself, when the file is one this plugin reads first;
	 * an import attribute selects a loader of its own, for a file that is neither
	 */
	static #loader(path: string, attributes?: Record<string, string>): Loader | undefined {
		if (attributes && Object.keys(attributes).length) return;
		return path.endsWith('.module.css') ? 'local-css' : Confined.LOADERS[extname(path)];
	}

	/**
	 * A file is read only from inside the package. The compiler names a file by where its links lead, or reached
	 * it expanding a pattern, so one outside is not named at all.
	 */
	#load = async (args: OnLoadArgs) => {
		if (!this.#confinement.inside(args.path)) return this.#refuse();

		const loader = Confined.#loader(args.path, args.with);
		if (!loader) return;
		const contents = await fs.readFile(args.path, 'utf8');
		const escaped = this.#globs.escape(args.path, contents);
		if (escaped) return this.#refuse(escaped, `a dynamic import of "${relative(this.#root, args.path).split(sep).join('/')}"`);

		const neutral = this.#maps.neutralize(args.path, contents, loader.endsWith('css'));
		return neutral === void 0 ? void 0 : { contents: neutral, loader, resolveDir: dirname(args.path) };
	};

	setup = (build: PluginBuild) => {
		build.onResolve({ filter: /.*/ }, this.#resolve);
		build.onLoad({ filter: /.*/, namespace: 'file' }, this.#load);
	};
}
