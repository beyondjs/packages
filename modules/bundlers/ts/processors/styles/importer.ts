import type { CanonicalizeContext, Importer as IImporter, ImporterResult } from 'sass';
import type { IDiagnostic } from '@beyond-js/packages/types';
import { Confinement } from '@beyond-js/packages/confinement';
import { existsSync, readFileSync, realpathSync, statSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { basename, dirname, extname, join, relative, sep } from 'path';

const EXTENSIONS = ['.sass', '.scss', '.css'];

/**
 * Resolves the stylesheets a Sass source loads when its package is compiled confined.
 *
 * It is the importer of the stylesheet being compiled, so every load without a scheme, from that stylesheet or
 * from one it loaded, reaches it resolved against the stylesheet that makes it. It finds the file the way Sass
 * finds one on disk (`name.sass`, `name.scss`, then `name.css`, each as itself or as the partial `_name`, then
 * the `index` of a directory, and the import-only `.import` variants for an `@import`), but only a file whose
 * real location is inside the package: an absolute path, a `..` that leaves the package and a symbolic link
 * whose target is outside are refused before anything is read, and the refusal is kept for the processor to
 * report as `SOURCE_CONFINED`. A load with a scheme reaches no importer and no load path, so it is not found.
 */
export class Importer implements IImporter<'sync'> {
	#confinement: Confinement;
	#root: string;

	#refused: IDiagnostic[] = [];

	/**
	 * The loads this importer refused, by the name of the file the source asked for
	 */
	get refused(): IDiagnostic[] {
		return [...this.#refused];
	}

	/**
	 * @param confinement The rules of the confined compilation
	 * @param root The root of the package, which names a file in a diagnostic
	 */
	constructor(confinement: Confinement, root: string) {
		this.#confinement = confinement;
		this.#root = root;
	}

	/**
	 * A file inside the package by the name the package gives it; the base name of a file outside, so no
	 * location of the machine is named
	 */
	#named(path: string): string {
		return this.#confinement.contains(path) ? relative(this.#root, path).split(sep).join('/') : basename(path);
	}

	#refuse(path: string): never {
		const diagnostic = Confinement.source(this.#named(path), 'a stylesheet');
		this.#refused.push(diagnostic);
		throw new Error(diagnostic.message);
	}

	/**
	 * Sass calls the members of an importer without the importer as `this`, so they are bound here
	 */
	canonicalize = (url: string, context: CanonicalizeContext): URL | null => {
		if (!url.startsWith('file:')) return null;

		const path = fileURLToPath(url);
		if (!this.#confinement.contains(path)) this.#refuse(path);

		const found = this.#resolve(path, context.fromImport);
		if (!found) return null;
		if (!this.#confinement.inside(found)) this.#refuse(found);
		return pathToFileURL(realpathSync(found));
	};

	load = (canonical: URL): ImporterResult => {
		const path = fileURLToPath(canonical);
		const extension = extname(path);
		const syntax = extension === '.sass' ? 'indented' : extension === '.css' ? 'css' : 'scss';
		return { contents: readFileSync(path, 'utf8'), syntax, sourceMapUrl: canonical };
	};

	/**
	 * The file a load names, resolved as Sass resolves a file on disk
	 */
	#resolve(path: string, imported: boolean): string | undefined {
		const extension = extname(path);
		if (EXTENSIONS.includes(extension)) {
			const variant = `${path.slice(0, -extension.length)}.import${extension}`;
			return (imported && this.#one(this.#candidates(variant))) || this.#one(this.#candidates(path));
		}

		const own = (imported && this.#one(this.#extensions(`${path}.import`))) || this.#one(this.#extensions(path));
		if (own || !existsSync(path) || !statSync(path).isDirectory()) return own;
		return (imported && this.#one(this.#extensions(join(path, 'index.import')))) || this.#one(this.#extensions(join(path, 'index')));
	}

	/**
	 * The files a name without an extension may be: Sass and SCSS first, CSS only when neither exists
	 */
	#extensions(path: string): string[] {
		const found = [...this.#candidates(`${path}.sass`), ...this.#candidates(`${path}.scss`)];
		return found.length ? found : this.#candidates(`${path}.css`);
	}

	/**
	 * A file as itself and as a partial, the ones that exist
	 */
	#candidates(path: string): string[] {
		const partial = join(dirname(path), `_${basename(path)}`);
		return [partial, path].filter(file => existsSync(file) && statSync(file).isFile());
	}

	#one(paths: string[]): string | undefined {
		if (paths.length > 1) {
			const found = paths.map(path => this.#named(path)).join(', ');
			throw new Error(`It is not clear which file to load: ${found}`);
		}
		return paths[0];
	}
}
