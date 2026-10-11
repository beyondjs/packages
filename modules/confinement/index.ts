import type { IDiagnostic } from '@beyond-js/packages/types';
import { realpathSync } from 'fs';
import { isAbsolute, relative, resolve, sep } from 'path';

/**
 * The rules of a confined compilation: the compilation of sources whose author the caller does not trust,
 * such as a package from a registry or one captured from a person's computer, prepared where a build must
 * not reach the machine it runs on. The caller selects it (`confined: true` in an analysis or a
 * generation request); nothing a package declares selects it or turns it off.
 *
 * - **No JavaScript a package supplies is loaded.** A bundler or a processor is imported only when it is one
 *   of the implementations this toolchain ships (`BUNDLERS`, `PROCESSORS`), and a module is composed only by
 *   a bundler that follows these rules (`COMPOSERS`); a Tailwind plugin is loaded only from the list the
 *   toolchain pins and from the toolchain's own installation, a Tailwind configuration never. Anything else
 *   is `PLUGIN_REFUSED`, before it is imported.
 * - **Every file a source names resolves inside a root, by its real path.** The roots are the package being
 *   compiled and the toolchain packages a processor pins (the stylesheets of Tailwind). An absolute path, a
 *   `..` that leaves the package and a symbolic link whose target is outside are `SOURCE_CONFINED`, and
 *   nothing is read through them.
 *
 * A compilation that is not confined (the development service, a local build) keeps its own behavior: it
 * compiles the person's own sources, which may load what they like.
 */
export /*bundle*/ class Confinement {
	/**
	 * The bundlers a confined compilation imports: the ones this toolchain ships
	 */
	static BUNDLERS = ['ts', 'esbuild', 'exports'].map(name => `@beyond-js/packages/bundlers/${name}`);

	/**
	 * The bundlers that compose a module in a confined compilation: the `ts` bundler, whose processors follow
	 * these rules. A module of the packaging bundler is compiled by the compiler the caller selected, and the
	 * exports bundler, which resolves, reads and writes files on its own, composes nothing confined.
	 */
	static COMPOSERS = ['@beyond-js/packages/bundlers/ts'];

	/**
	 * The processors a confined compilation imports: those the `ts` bundler composes an executable module
	 * with. The declaration processor (`tsc`) is not one of them, because its program resolves what a source
	 * names without these rules, and neither is the processor of the packaging bundler, which loads the
	 * compiler a package names.
	 */
	static PROCESSORS = ['ts', 'styles', 'vue', 'svelte'].map(name => `@beyond-js/packages/bundlers/ts/processors/${name}`);

	/**
	 * Each root as it was given and by its real location, so a path written from either form is compared
	 */
	#roots: string[];
	get roots(): string[] {
		return [...this.#roots];
	}

	/**
	 * @param roots The directories the compilation may read: the package, and any toolchain package a
	 * processor pins
	 */
	constructor(roots: string[]) {
		const forms = roots.flatMap(root => [resolve(root), Confinement.#real(root)]);
		this.#roots = [...new Set(forms.filter(Boolean))];
	}

	static #real(path: string): string | undefined {
		try {
			return realpathSync(path);
		} catch {
			return void 0;
		}
	}

	/**
	 * Whether a path is a root or lies under one
	 */
	static within(root: string, path: string): boolean {
		const named = relative(root, path);
		return named === '' || (named !== '..' && !named.startsWith(`..${sep}`) && !isAbsolute(named));
	}

	/**
	 * Whether a path is inside a root as it is written, which is checked before anything is resolved or read,
	 * so an absolute path or a `..` that leaves the package is refused whether or not it exists
	 */
	contains(path: string): boolean {
		const absolute = resolve(path);
		return this.#roots.some(root => Confinement.within(root, absolute));
	}

	/**
	 * Whether an existing file or directory is inside a root by its real path. A path that does not exist is
	 * not: nothing can be read from it.
	 */
	inside(path: string): boolean {
		const real = Confinement.#real(path);
		return !!real && this.#roots.some(root => Confinement.within(root, real));
	}

	/**
	 * The diagnostic of a file a source names that a confined compilation does not read. The file is named as
	 * the source wrote it, never by where it leads: that location is a fact of the machine, and a file the
	 * compiler reached on its own is not named at all.
	 *
	 * @param named The name as the source wrote it, or the path of the file inside the package
	 * @param by What names it: the importing source, a manifest key
	 */
	static source(named?: string, by?: string): IDiagnostic {
		const what = named === void 0 ? 'A file' : `"${Confinement.#short(named)}"`;
		const message =
			`${what}${by ? ` (named by ${by})` : ''} resolves outside the package. A confined compilation reads ` +
			`only the files of the package it compiles, and the stylesheets the toolchain pins`;
		return { code: 'SOURCE_CONFINED', message };
	}

	/**
	 * The diagnostic of code a confined compilation does not run: code a package supplies, or a toolchain
	 * bundler that does not compose confined
	 *
	 * @param kind What the code would be: a bundler, a processor, a Tailwind plugin or configuration
	 */
	static plugin(kind: string, named: string): IDiagnostic {
		const message =
			`The ${kind} "${Confinement.#short(named)}" does not run: a confined compilation runs no code a ` +
			`package supplies, only the implementations the toolchain pins for it`;
		return { code: 'PLUGIN_REFUSED', message };
	}

	/**
	 * A name kept short enough to read, as a `data:` URL can carry a whole program
	 */
	static #short(named: string): string {
		const text = String(named);
		return text.length > 120 ? `${text.slice(0, 117)}...` : text;
	}
}
