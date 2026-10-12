import type { IDiagnostic, IConditions } from '@beyond-js/packages/types';
import { Bundle, Compiler, Located, type IBundled, type IBundleRequest } from '@beyond-js/packages/bundlers/esbuild/processors/bundle';
import { Exports } from '@beyond-js/packages/publication';
import { Interop, Sharing, type IPublicModule } from '@beyond-js/packages/analysis';
import { ConditionalOutput } from '@beyond-js/packages/module/output';
import { existsSync, realpathSync, statSync } from 'fs';
import { extname, join } from 'path';
import type { IInstalledModule, IInstalledResult } from './installed';

/**
 * One public module of an installed package, as the packaging path is asked for it
 */
interface IPackagedRequest {
	name: string;
	version: string;
	subpath: string;

	/**
	 * With an execution: the key of the node of the installed graph it is compiled from
	 */
	key?: string;
}

/**
 * The esbuild packaging path of the installed packages a browser needs: each public module is one ES module, its bare
 * references kept, as the CDN generation produces it.
 *
 * - A subpath of an ordinary npm package is resolved through its `exports`, its CommonJS shape adapted to named
 *   exports, and the subpaths whose graphs share files are delivered as one carrier and its facades ([Sharing]).
 * - A module of a package published as Beyond sources that no bundler of its own composes is entered at the file its
 *   manifest declares, compiled confined, as the preparation of a pinned package compiles it.
 *
 * Either way the other public modules of the package stay references, so two modules never carry one state, and the
 * maps name every source by its absolute path where the package is installed.
 */
export class Packaging {
	#sharing = new Sharing();

	/**
	 * The compiler this environment compiles installed packages with: the one named by `BEYOND_ESBUILD_COMPILER`, or the
	 * `esbuild` installed with Packages
	 */
	static get compiler(): string {
		return process.env.BEYOND_ESBUILD_COMPILER ? 'env:BEYOND_ESBUILD_COMPILER' : 'esbuild';
	}

	/**
	 * The file a target of a package names, with the extensions Node would try, by its real path
	 */
	static #file(root: string, target: string): string | undefined {
		const base = join(root, target);
		const candidates = [base, `${base}.js`, `${base}.mjs`, `${base}.cjs`, join(base, 'index.js')];
		const found = candidates.find(candidate => existsSync(candidate) && statSync(candidate).isFile());
		return found && realpathSync(found);
	}

	/**
	 * A public subpath of an ordinary npm package, resolved through its `exports`
	 *
	 * @param root The real location of the package
	 */
	async exports(module: IPackagedRequest, conditions: IConditions, root: string, manifest: Record<string, any>): Promise<IInstalledResult> {
		const { name, subpath } = module;
		const exports = new Exports(manifest);
		const { platform, environment } = conditions;
		const mode = environment ?? 'production';
		const resolved = exports.resolve(subpath, platform, mode);
		if (!resolved.target) return { failure: resolved.diagnostics[0] };

		const entry = Packaging.#file(root, resolved.target);
		if (!entry) return { failure: { code: 'MODULE_NOT_FOUND', message: `"${name}${subpath.slice(1)}" resolves to "${resolved.target}", which does not exist` } };
		if (!['.js', '.mjs', '.cjs', '.json', '.css'].includes(extname(entry))) {
			return { failure: { code: 'OUTPUT_NOT_AVAILABLE', message: `"${name}${subpath.slice(1)}" resolves to "${resolved.target}", which is not code or a stylesheet` } };
		}

		const compiler = await Compiler.load(Packaging.compiler, process.cwd());
		if (compiler.error) return { failure: compiler.error };

		// The other public subpaths of the package stay references, so two modules never carry one state
		const entries = new Map<string, string>();
		exports.subpaths.forEach(other => {
			const target = other !== subpath && exports.resolve(other, platform, mode).target;
			const file = target && !target.endsWith('.json') && Packaging.#file(root, target);
			file && file !== entry && !entries.has(file) && entries.set(file, other === '.' ? name : `${name}/${other.slice(2)}`);
		});

		// Except the subpaths whose graphs share files: a carrier bundles them and each is a facade over it
		const settings = { platform: platform === 'browser' ? 'web' : platform, environment, conditions: Exports.conditions(platform, mode), mode };
		const subpaths = exports.subpaths;
		const resolve = (one: string) => exports.resolve(one, platform, mode);
		const plan = await this.#sharing.plan({ ...settings, root, name, manifest, subpaths, resolve, compiler, file: target => Packaging.#file(root, target) });
		const role = plan.role(subpath);
		const facade =
			role.kind === 'facade' ? plan.facade(subpath) : role.kind === 'carrier' ? plan.union(subpath) : extname(entry) === '.css' ? void 0 : await new Interop(entry, manifest.type, resolved.via).facade(root);
		const bundle = { ...settings, root, entry, facade, entries: plan.externals(subpath, entries), package: { root, subpath }, minify: environment === 'production' };
		return this.#bundle(compiler, module, bundle, root);
	}

	/**
	 * A module of a package published as Beyond sources that no bundler of its own composes, entered at the file its
	 * manifest declares and compiled confined
	 *
	 * @param packaged The module as the package declares it, the real location of the package, and the entry points of
	 * its other public modules
	 */
	async entry(module: IPackagedRequest, conditions: IConditions, packaged: { module: IPublicModule; root: string; entries: Map<string, string> }): Promise<IInstalledResult> {
		const compiler = await Compiler.load(Packaging.compiler, process.cwd());
		if (compiler.error) return { failure: compiler.error };

		const { platform, environment } = conditions;
		const { directory, entry } = packaged.module;
		const bundle = { root: directory, entry, entries: packaged.entries, package: { root: packaged.root, subpath: module.subpath } };
		const settings = { platform: platform === 'browser' ? 'web' : platform, environment, minify: environment === 'production', confined: true };
		return this.#bundle(compiler, module, { ...bundle, ...settings }, packaged.root);
	}

	/**
	 * Bundles one public module and describes it
	 *
	 * @param base The root of its package, which the sources of its maps are named under
	 */
	async #bundle(compiler: Compiler, module: IPackagedRequest, request: IBundleRequest, base: string): Promise<IInstalledResult> {
		const { bundled, diagnostics } = await new Bundle(compiler, request).run();
		if (!bundled) return { failure: <IDiagnostic>{ code: 'BUILD_FAILED', message: diagnostics[0]?.message ?? `"${module.name}" could not be compiled`, diagnostics } };

		// Its maps are delivered inline: every source is named by its absolute path in the installation
		const located = new Located(request.root, base);
		Object.assign(bundled, { map: located.map(bundled.map), cssmap: located.map(bundled.cssmap) });
		return { module: Packaging.#describe(module, bundled) };
	}

	static #describe({ name, version, subpath, key }: IPackagedRequest, bundled: IBundled): IInstalledModule {
		const output = new ConditionalOutput();
		output.set({ code: bundled.code ?? '', map: bundled.map });

		let styles: ConditionalOutput;
		if (typeof bundled.css === 'string') {
			styles = new ConditionalOutput();
			styles.set({ code: bundled.css, map: bundled.cssmap });
		}
		return {
			name,
			version,
			subpath,
			...(key ? { key } : {}),
			hash: output.hash,
			code: sourcemap => output.code(sourcemap === 'inline' ? 'sourcemap-inline' : 'raw-code'),
			styles,
			dependencies: bundled.dependencies,
			stylesheets: bundled.references.filter(({ kind }) => kind === 'style').map(({ specifier }) => specifier),
			compiler: { specifier: bundled.compiler.specifier, version: bundled.compiler.version }
		};
	}
}
