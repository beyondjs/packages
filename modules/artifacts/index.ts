import type { Workspace } from '@beyond-js/packages/workspace';
import type { IDiagnostic } from '@beyond-js/packages/types';
import type { IArtifact, IArtifactsOptions, IArtifactsReport } from './types';
import { Dependencies } from './dependencies';
import { ImportMap } from './importmap';
import { Conditions } from './conditions';
import { Compilation } from './compilation';
import { Files } from './files';

/**
 * Writes the public modules of a workspace as executable artifacts for a set of conditions.
 *
 * Each public module produces one ES module file, its source map and an update file (the one that
 * addresses an already loaded runtime package). Public references between modules remain bare specifiers
 * in the emitted code, so an import map is written next to the artifacts for a consumer runtime to
 * resolve them.
 *
 * ```ts
 * const workspace = new Workspace('/path/to/workspace');
 * const artifacts = new Artifacts(workspace, { path: '/path/to/output', conditions: { platform: 'node' } });
 * const report = await artifacts.build();
 * ```
 *
 * `build()` reports diagnostics instead of throwing, so one call describes every module of the workspace.
 * A module with diagnostics, including those of its dependencies, is not published: its artifact is not
 * written, it is left out of the import map, and the files a previous build wrote for it are removed.
 * This object owns artifact production only: it neither serves the artifacts nor notifies consumers that
 * they changed.
 */
export /*bundle*/ class Artifacts {
	#workspace: Workspace;
	#options: IArtifactsOptions;

	#conditions: Conditions;
	#dependencies: Dependencies;

	constructor(workspace: Workspace, options: IArtifactsOptions) {
		if (!options?.path) throw new Error('The artifacts path is required');

		this.#workspace = workspace;
		this.#options = options;
		this.#conditions = new Conditions(options.conditions);
		this.#dependencies = new Dependencies(workspace);
	}

	/**
	 * The key under which the selected conditions are registered in the conditionals collection of a module,
	 * which is `platform` or `platform/environment`
	 */
	get key(): string {
		return this.#conditions.key;
	}

	/**
	 * Compiles and writes every public module of the workspace, together with the import map that resolves
	 * their public specifiers.
	 *
	 * A module that fails does not interrupt the others: its diagnostics are collected, and its artifact is
	 * left out of the report, of the import map and of the artifacts directory.
	 */
	async build(): Promise<IArtifactsReport> {
		const workspace = this.#workspace;
		const { path, conditions } = this.#options;
		const errors: IDiagnostic[] = [];
		const warnings: IDiagnostic[] = [];
		const artifacts: IArtifact[] = [];
		const importmap = new ImportMap(conditions);
		const files = new Files(path, this.key);

		await workspace.ready;
		workspace.errors.forEach(error => errors.push(error));
		workspace.warnings.forEach(warning => warnings.push(warning));

		for (const [location, pkg] of workspace.packages) {
			await pkg.ready;
			if (!pkg.valid) {
				pkg.errors.forEach(({ code, message }) =>
					errors.push({ code, message: `Package "${location}": ${message}` })
				);
				continue;
			}

			await pkg.modules.ready;
			const prefix = `Package "${pkg.name}": `;
			pkg.modules.errors.forEach(({ code, message }) => errors.push({ code, message: prefix + message }));
			pkg.modules.warnings.forEach(({ code, message }) => warnings.push({ code, message: prefix + message }));

			for (const subpath of pkg.modules.keys()) {
				const compilation = new Compilation(pkg, subpath, this.#conditions, this.#dependencies);
				await compilation.run();
				if (!compilation.valid) {
					compilation.errors.forEach(error => errors.push(error));
					continue;
				}

				const artifact = await this.#write(compilation, files);
				artifacts.push(artifact);
				importmap.add(artifact);
			}
		}

		await files.prune();
		return { path, conditions, artifacts, errors, warnings, importmap: await importmap.write(path) };
	}

	/**
	 * Writes the artifact of a valid compilation and describes it
	 */
	async #write(compilation: Compilation, files: Files): Promise<IArtifact> {
		const { package: pkg, subpath, conditional } = compilation;
		const { artifact: assembled } = conditional;

		const vname = `${pkg.name}@${pkg.version}`;
		const file = files.name(vname, subpath, false);
		const patch = files.name(vname, subpath, true);
		await files.write(conditional, file, patch);

		return {
			specifier: compilation.specifier,
			vspecifier: assembled.vspecifier,
			package: pkg.name,
			version: pkg.version,
			subpath,
			conditions: this.#options.conditions,
			file,
			patch,
			hash: conditional.output.hash,
			exports: assembled.exports,
			ims: assembled.ims,
			dependencies: compilation.dependencies
		};
	}
}
