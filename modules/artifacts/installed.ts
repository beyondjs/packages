import type { IDiagnostic, IConditions } from '@beyond-js/packages/types';
import type { Execution } from '@beyond-js/packages/execution';
import type { Package } from '@beyond-js/packages/package';
import type { ConditionalOutput } from '@beyond-js/packages/module/output';
import { readFileSync, statSync } from 'fs';
import { join } from 'path';
import { Instances, type IInstance } from './instances';
import { Authored, type IAuthoredModule } from './authored';
import { Packaging } from './packaging';

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
 * What compiling a public module of an installed package answers
 */
export /*bundle*/ interface IInstalledResult {
	/**
	 * The module packaged by this environment: a subpath of an ordinary npm package, or a module of a package published
	 * as Beyond sources that no bundler of its own composes
	 */
	module?: IInstalledModule;

	/**
	 * With an execution, for a package published as Beyond sources whose module a bundler of its own composes: the
	 * package to compile it from, as a member of the workspace is compiled
	 */
	composed?: Package;

	failure?: IDiagnostic;
}

/**
 * The installed packages that a browser needs and the workspace does not contain: the frameworks and
 * libraries the modules import by bare specifier, such as `react` or `vue`.
 *
 * A Node consumer resolves them itself from the package that imports them. A browser cannot, and in
 * development there is no CDN to ask, so this environment compiles them: each public subpath of an
 * installed package is one ES module, produced by the esbuild packaging path with its bare references
 * kept and its CommonJS shape adapted, exactly as the CDN generation does ([Packaging](./packaging.ts)). Only the
 * exact version that was requested is served, and nothing is served that is not installed.
 *
 * With the execution projection of an installed graph, a package is a node of that graph, compiled from the
 * canonical location of its sources; which node an importer reaches is decided by serving, from the
 * instances that reached the importer. Without one, a package is found where Node finds it for the packages of
 * the workspace, the ones the toolchain supplies and the toolchain itself ([Instances](./instances.ts)).
 *
 * With an execution, a node is also compiled as its package declares (`beyond-publication/1`): one published as
 * Beyond sources by the bundlers it declares ([Authored](./authored.ts)), one whose declaration cannot be read not at
 * all. Without one, every installed package is compiled by the packaging path from its `exports`.
 */
export /*bundle*/ class Installed {
	#instances: Instances;
	#compiled: Map<string, Promise<IInstalledResult>> = new Map();
	#packaging = new Packaging();

	/**
	 * With an execution: the nodes published as Beyond sources, opened to be compiled by the bundlers they declare
	 */
	#authored: Authored | undefined;

	/**
	 * @param bases The directories to resolve installed packages from without an execution
	 * @param execution The execution projection of the installed graph, which replaces the directories
	 */
	constructor(bases: () => string[], execution?: Execution) {
		this.#instances = new Instances(bases, execution);
		this.#authored = execution ? new Authored() : void 0;
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
		return Packaging.compiler;
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
	 * part of what the result is kept under, and a replaced one is compiled again. A module a bundler of its
	 * package composes is answered with that package (`composed`), whose compilations keep their own outputs.
	 */
	module(request: { name: string; version: string; subpath: string; key?: string }, conditions: IConditions): Promise<IInstalledResult> {
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

	async #compile(request: { name: string; version: string; subpath: string }, conditions: IConditions, instance: IInstance): Promise<IInstalledResult> {
		const root = instance.location;
		if (!root) return { failure: instance.failure };
		const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
		const module = { ...request, key: instance.key };

		// With an installed graph the package says how it is compiled; a declaration that cannot be read selects nothing
		const form = this.#authored?.form(instance, manifest, String(Installed.#written(root)));
		const declared = form?.publication.diagnostics ?? [];
		if (form && !form.publication.form) {
			const message = `"${request.name}@${request.version}" declares no publication form that can be read: ${declared[0]?.message}`;
			return { failure: <IDiagnostic>{ code: 'BUILD_FAILED', message, diagnostics: declared } };
		}
		if (form?.opened) {
			const authored: IAuthoredModule = await this.#authored.module(form.opened, request.subpath, conditions);
			if (authored.failure) return { failure: authored.failure };
			return authored.composed ? { composed: authored.composed } : this.#packaging.entry(module, conditions, authored.packaged);
		}

		// A manifest that names Beyond modules without the source form is read as an ordinary npm package: a failure says so
		const answer = await this.#packaging.exports(module, conditions, root, manifest);
		if (!answer.failure || !declared.length) return answer;
		const diagnostics = (<{ diagnostics?: IDiagnostic[] }>answer.failure).diagnostics ?? [answer.failure];
		return { failure: <IDiagnostic>{ ...answer.failure, diagnostics: [...diagnostics, ...declared] } };
	}

	/**
	 * Releases the packages opened to be compiled by the bundlers they declare
	 */
	destroy(): void {
		this.#authored?.destroy();
		this.#compiled.clear();
	}
}
