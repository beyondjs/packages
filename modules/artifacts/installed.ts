import type { IDiagnostic, IConditions } from '@beyond-js/packages/types';
import { Bundle, Compiler, type IBundled } from '@beyond-js/packages/bundlers/esbuild/processors/bundle';
import { Exports } from '@beyond-js/packages/publication';
import { Interop } from '@beyond-js/packages/analysis';
import { ConditionalOutput } from '@beyond-js/packages/module/output';
import { Sharing } from './sharing';
import { createRequire } from 'module';
import { existsSync, readFileSync, realpathSync, statSync } from 'fs';
import { dirname, extname, join } from 'path';
import { pathToFileURL } from 'url';

/**
 * A public module of an installed package, compiled for a browser
 */
export /*bundle*/ interface IInstalledModule {
	name: string;
	version: string;
	subpath: string;
	hash: string;
	code: (sourcemap: 'inline' | 'none') => string;
	styles?: ConditionalOutput;
	dependencies: string[];
	compiler: { specifier: string; version: string };
}

/**
 * The installed packages that a browser needs and the workspace does not contain: the frameworks and
 * libraries the modules import by bare specifier, such as `react` or `vue`.
 *
 * A Node consumer resolves them itself from the package that imports them. A browser cannot, and in
 * development there is no CDN to ask, so this environment compiles them: each public subpath of an
 * installed package is one ES module, produced by the esbuild packaging path with its bare references
 * kept and its CommonJS shape adapted, exactly as the CDN generation does. A package is found where Node
 * finds it for the packages of the workspace, the ones the toolchain supplies and the toolchain itself,
 * and only at the exact version that was requested. Nothing is served that is not installed.
 */
export /*bundle*/ class Installed {
	#bases: () => string[];
	#compiled: Map<string, Promise<{ module?: IInstalledModule; failure?: IDiagnostic }>> = new Map();
	#sharing = new Sharing();

	/**
	 * @param bases The directories to resolve installed packages from
	 */
	constructor(bases: () => string[]) {
		this.#bases = bases;
	}

	/**
	 * The compiler this environment compiles installed packages with: the one named by
	 * `BEYOND_ESBUILD_COMPILER`, or the `esbuild` installed with Packages
	 */
	static get compiler(): string {
		return process.env.BEYOND_ESBUILD_COMPILER ? 'env:BEYOND_ESBUILD_COMPILER' : 'esbuild';
	}

	/**
	 * The root of an installed package by name, as found from a directory. A package whose `exports` hide
	 * its manifest is found from its entry point, walking up to the manifest that carries its name.
	 */
	static root(name: string, from: string): string | undefined {
		const require = createRequire(pathToFileURL(join(from, 'noop.js')).href);
		try {
			return dirname(require.resolve(`${name}/package.json`));
		} catch (error) {
			if (error.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') return;
		}
		try {
			for (let current = dirname(require.resolve(name)); dirname(current) !== current; current = dirname(current)) {
				const manifest = join(current, 'package.json');
				if (existsSync(manifest) && JSON.parse(readFileSync(manifest, 'utf8')).name === name) return current;
			}
		} catch {
			return;
		}
	}

	/**
	 * Where a package is installed at exactly the requested version, or undefined
	 */
	locate(name: string, version: string): string | undefined {
		for (const base of this.#bases()) {
			const root = Installed.root(name, base);
			if (!root) continue;
			try {
				const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
				if (manifest.version === version) return realpathSync(root);
			} catch {
				// A manifest that cannot be read is not an installation
			}
		}
	}

	/**
	 * The version of a package installed from a directory, if any
	 */
	static version(name: string, from: string): string | undefined {
		const root = Installed.root(name, from);
		try {
			return root && JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
		} catch {
			return;
		}
	}

	/**
	 * Compiles a public module of an installed package. The result is kept for the process: an installed
	 * package does not change while the service runs.
	 */
	module(request: { name: string; version: string; subpath: string }, conditions: IConditions) {
		const key = JSON.stringify([request.name, request.version, request.subpath, conditions.platform, conditions.environment ?? '']);
		!this.#compiled.has(key) && this.#compiled.set(key, this.#compile(request, conditions));
		return this.#compiled.get(key);
	}

	#file(root: string, target: string): string | undefined {
		const base = join(root, target);
		const candidates = [base, `${base}.js`, `${base}.mjs`, `${base}.cjs`, join(base, 'index.js')];
		const found = candidates.find(candidate => existsSync(candidate) && statSync(candidate).isFile());
		return found && realpathSync(found);
	}

	async #compile({ name, version, subpath }: { name: string; version: string; subpath: string }, conditions: IConditions) {
		const root = this.locate(name, version);
		if (!root) return { failure: { code: 'PACKAGE_NOT_FOUND', message: `"${name}@${version}" is neither a package of the workspace nor installed for it` } };

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
		const plan = await this.#sharing.plan({ ...settings, root, name, manifest, exports, compiler, file: target => this.#file(root, target) });
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

		return { module: Installed.#describe(name, version, subpath, bundled) };
	}

	static #describe(name: string, version: string, subpath: string, bundled: IBundled): IInstalledModule {
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
			hash: output.hash,
			code: sourcemap => output.code(sourcemap === 'inline' ? 'sourcemap-inline' : 'raw-code'),
			styles,
			dependencies: bundled.dependencies,
			compiler: { specifier: bundled.compiler.specifier, version: bundled.compiler.version }
		};
	}
}
