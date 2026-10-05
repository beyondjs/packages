import type { IDiagnostic, IConditions } from '@beyond-js/packages/types';
import type { Execution } from '@beyond-js/packages/execution';
import { Bundle, Compiler, Located, type IBundled } from '@beyond-js/packages/bundlers/esbuild/processors/bundle';
import { Exports } from '@beyond-js/packages/publication';
import { Interop, Sharing } from '@beyond-js/packages/analysis';
import { ConditionalOutput } from '@beyond-js/packages/module/output';
import { existsSync, readFileSync, realpathSync, statSync } from 'fs';
import { extname, join } from 'path';
import { Instances, type IInstance } from './instances';

/**
 * A public module of an installed package, compiled for a browser
 */
export /*bundle*/ interface IInstalledModule {
	name: string;
	version: string;
	subpath: string;

	/**
	 * With an execution: the key of the node of the installed graph it was compiled from
	 */
	key?: string;

	hash: string;
	code: (sourcemap: 'inline' | 'none') => string;
	styles?: ConditionalOutput;
	dependencies: string[];

	/**
	 * The stylesheets its sources select (`pkg/sub.css`), removed from its code
	 */
	stylesheets: string[];
	compiler: { specifier: string; version: string };
}

/**
 * The installed packages that a browser needs and the workspace does not contain: the frameworks and
 * libraries the modules import by bare specifier, such as `react` or `vue`.
 *
 * A Node consumer resolves them itself from the package that imports them. A browser cannot, and in
 * development there is no CDN to ask, so this environment compiles them: each public subpath of an
 * installed package is one ES module, produced by the esbuild packaging path with its bare references
 * kept and its CommonJS shape adapted, exactly as the CDN generation does. Only the exact version that was
 * requested is served, and nothing is served that is not installed.
 *
 * With the execution projection of an installed graph, a package is a node of that graph, compiled from the
 * canonical location of its sources; which node an importer reaches is decided by serving, from the
 * instances that reached the importer. Without one, a package is found where Node finds it for the packages of
 * the workspace, the ones the toolchain supplies and the toolchain itself ([Instances](./instances.ts)).
 */
export /*bundle*/ class Installed {
	#instances: Instances;
	#compiled: Map<string, Promise<{ module?: IInstalledModule; failure?: IDiagnostic }>> = new Map();
	#sharing = new Sharing();

	/**
	 * @param bases The directories to resolve installed packages from without an execution
	 * @param execution The execution projection of the installed graph, which replaces the directories
	 */
	constructor(bases: () => string[], execution?: Execution) {
		this.#instances = new Instances(bases, execution);
	}

	/**
	 * The execution projection the installed packages are located with, when there is one
	 */
	get execution(): Execution | undefined {
		return this.#instances.execution;
	}

	/**
	 * The compiler this environment compiles installed packages with: the one named by
	 * `BEYOND_ESBUILD_COMPILER`, or the `esbuild` installed with Packages
	 */
	static get compiler(): string {
		return process.env.BEYOND_ESBUILD_COMPILER ? 'env:BEYOND_ESBUILD_COMPILER' : 'esbuild';
	}

	/**
	 * The root of an installed package by name, as Node finds it from a directory. A package whose `exports`
	 * hide its manifest is found from its entry point, walking up to the manifest that carries its name.
	 */
	static root(name: string, from: string): string | undefined {
		return Instances.root(name, from);
	}

	/**
	 * The version of a package installed from a directory, as Node finds it, if any
	 */
	static version(name: string, from: string): string | undefined {
		const root = Instances.root(name, from);
		return root && Instances.version(root);
	}

	/**
	 * Where a package is installed at exactly the requested version, or undefined
	 *
	 * @param key With an execution, the node to locate
	 */
	locate(name: string, version: string, key?: string): string | undefined {
		return this.#instances.locate(name, version, key).location;
	}

	/**
	 * Whether a module that the workspace could not select is looked for among the installed packages: a
	 * package the workspace does not contain, for a browser, and with an execution also a version of a name
	 * the workspace holds only in other versions, when the installed graph has that version (an alias reaches
	 * the registry copy of a member's name)
	 *
	 * @param code Why the workspace could not select it
	 */
	serves(code: string, request: { name: string; version: string }, conditions: IConditions): boolean {
		if (conditions.platform === 'node') return false;
		if (code === 'PACKAGE_NOT_FOUND') return true;
		return code === 'VERSION_MISMATCH' && !!this.execution && !!this.locate(request.name, request.version);
	}

	/**
	 * Compiles a public module of an installed package. The result is kept while the installation it was
	 * compiled from stays where it is and unchanged: a name and version do not identify bytes in development,
	 * where reinstalling from another registry, a patched copy or a new link replaces the files under the same
	 * version, so the installation located now — its real location and when its manifest was written — is
	 * part of what the result is kept under, and a replaced one is compiled again.
	 */
	module(request: { name: string; version: string; subpath: string; key?: string }, conditions: IConditions) {
		const instance = this.#instances.locate(request.name, request.version, request.key);
		const root = instance.location;
		// The node is part of what a result is kept under: one location could hold another node after an install
		const installation = root ? `${instance.key ?? ''}\n${root}\n${Installed.#written(root)}` : '';
		// The node located, not whether the request named it, is what a result is kept for
		const requested = JSON.stringify([request.name, request.version, request.subpath, conditions.platform, conditions.environment ?? '']);
		const key = `${requested}\n${installation}`;
		if (!this.#compiled.has(key)) {
			// What was compiled from an installation that was replaced is never answered again
			[...this.#compiled.keys()].filter(one => one.startsWith(`${requested}\n`)).forEach(one => this.#compiled.delete(one));
			this.#compiled.set(key, this.#compile(request, conditions, instance));
		}
		return this.#compiled.get(key);
	}

	/**
	 * When the manifest of an installation was written, or nothing when it was removed since the package was
	 * located: a stamp is never a reason for `module()` to throw instead of answering
	 */
	static #written(root: string): number | '' {
		try {
			return statSync(join(root, 'package.json')).mtimeMs;
		} catch {
			return '';
		}
	}

	#file(root: string, target: string): string | undefined {
		const base = join(root, target);
		const candidates = [base, `${base}.js`, `${base}.mjs`, `${base}.cjs`, join(base, 'index.js')];
		const found = candidates.find(candidate => existsSync(candidate) && statSync(candidate).isFile());
		return found && realpathSync(found);
	}

	async #compile({ name, version, subpath }: { name: string; version: string; subpath: string }, conditions: IConditions, instance: IInstance) {
		const root = instance.location;
		if (!root) return { failure: instance.failure };

		const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
		const exports = new Exports(manifest);
		const { platform, environment } = conditions;
		const mode = environment ?? 'production';
		const resolved = exports.resolve(subpath, platform, mode);
		if (!resolved.target) return { failure: resolved.diagnostics[0] };

		const entry = this.#file(root, resolved.target);
		if (!entry) return { failure: { code: 'MODULE_NOT_FOUND', message: `"${name}${subpath.slice(1)}" resolves to "${resolved.target}", which does not exist` } };
		if (!['.js', '.mjs', '.cjs', '.json', '.css'].includes(extname(entry))) {
			return { failure: { code: 'OUTPUT_NOT_AVAILABLE', message: `"${name}${subpath.slice(1)}" resolves to "${resolved.target}", which is not code or a stylesheet` } };
		}

		const compiler = await Compiler.load(Installed.compiler, process.cwd());
		if (compiler.error) return { failure: compiler.error };

		// The other public subpaths of the package stay references, so two modules never carry one state
		const entries = new Map<string, string>();
		exports.subpaths.forEach(other => {
			const target = other !== subpath && exports.resolve(other, platform, mode).target;
			const file = target && !target.endsWith('.json') && this.#file(root, target);
			file && file !== entry && !entries.has(file) && entries.set(file, other === '.' ? name : `${name}/${other.slice(2)}`);
		});

		// Except the subpaths whose graphs share files: a carrier bundles them and each is a facade over it
		const settings = { platform: platform === 'browser' ? 'web' : platform, environment, conditions: Exports.conditions(platform, mode), mode };
		const subpaths = exports.subpaths;
		const resolve = (one: string) => exports.resolve(one, platform, mode);
		const plan = await this.#sharing.plan({ ...settings, root, name, manifest, subpaths, resolve, compiler, file: target => this.#file(root, target) });
		const role = plan.role(subpath);
		const facade =
			role.kind === 'facade' ? plan.facade(subpath) : role.kind === 'carrier' ? plan.union(subpath) : extname(entry) === '.css' ? void 0 : await new Interop(entry, manifest.type, resolved.via).facade(root);
		const { bundled, diagnostics } = await new Bundle(compiler, {
			...settings,
			root,
			entry,
			facade,
			entries: plan.externals(subpath, entries),
			package: { root, subpath },
			minify: environment === 'production'
		}).run();
		if (!bundled) return { failure: { code: 'BUILD_FAILED', message: diagnostics[0]?.message ?? `"${name}" could not be compiled`, diagnostics } };

		// Its maps are delivered inline: every source is named by its absolute path in the installation
		const located = new Located(root, root);
		Object.assign(bundled, { map: located.map(bundled.map), cssmap: located.map(bundled.cssmap) });
		return { module: Installed.#describe(name, version, subpath, bundled, instance.key) };
	}

	static #describe(name: string, version: string, subpath: string, bundled: IBundled, key?: string): IInstalledModule {
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
