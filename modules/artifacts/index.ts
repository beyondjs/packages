import type { Workspace } from '@beyond-js/packages/workspace';
import type { Package } from '@beyond-js/packages/package';
import type { BaseModule } from '@beyond-js/packages/module';
import type { IDiagnostic } from '@beyond-js/packages/types';
import type { ESMConditional } from '@beyond-js/packages/sdk';
import type { IArtifact, IArtifactsOptions, IArtifactsReport } from './types';
import { Dependencies } from './dependencies';
import { ImportMap } from './importmap';
import { promises as fs } from 'fs';
import { join, dirname, posix } from 'path';

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
 * This object owns artifact production only: it neither serves the artifacts nor notifies consumers that
 * they changed.
 */
export /*bundle*/ class Artifacts {
	#workspace: Workspace;
	#options: IArtifactsOptions;

	#dependencies: Dependencies;

	constructor(workspace: Workspace, options: IArtifactsOptions) {
		if (!options?.path) throw new Error('The artifacts path is required');
		if (typeof options.conditions?.platform !== 'string') throw new Error('The platform condition is required');

		this.#workspace = workspace;
		this.#options = options;
		this.#dependencies = new Dependencies(workspace);
	}

	/**
	 * The key under which the selected conditions are registered in the conditionals collection of a module,
	 * which is `platform` or `platform/environment`
	 */
	get key(): string {
		const { platform, environment } = this.#options.conditions;
		return environment ? `${platform}/${environment}` : platform;
	}

	/**
	 * The file of a public module artifact, relative to the artifacts directory.
	 *
	 * The versioned package directory keeps two versions of one package apart, and the conditions are part
	 * of the file name so that several conditionals of one module coexist.
	 */
	#file(pkg: Package, subpath: string, patch: boolean): string {
		const name = subpath === '.' ? 'index' : subpath.replace(/^\.\//, '');
		const conditions = this.key.replace('/', '.');
		return posix.join(`${pkg.name}@${pkg.version}`, `${name}.${conditions}${patch ? '.hmr' : ''}.mjs`);
	}

	/**
	 * Compiles and writes every public module of the workspace, together with the import map that resolves
	 * their public specifiers.
	 *
	 * A module that fails does not interrupt the others: its diagnostics are collected, and its artifact is
	 * left out of the report and of the import map.
	 */
	async build(): Promise<IArtifactsReport> {
		const workspace = this.#workspace;
		const { path, conditions } = this.#options;
		const errors: IDiagnostic[] = [];
		const warnings: IDiagnostic[] = [];
		const artifacts: IArtifact[] = [];
		const importmap = new ImportMap(conditions);

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

			for (const [subpath, module] of pkg.modules) {
				const specifier = subpath === '.' ? pkg.name : `${pkg.name}/${subpath.replace(/^\.\//, '')}`;
				const artifact = await this.#module(pkg, specifier, subpath, module, errors);
				if (!artifact) continue;

				artifacts.push(artifact);
				importmap.add(artifact);
			}
		}

		return { path, conditions, artifacts, errors, warnings, importmap: await importmap.write(path) };
	}

	/**
	 * Compiles one public module and writes its artifact, source map and update
	 *
	 * @returns The written artifact, or undefined when the module produced diagnostics instead of output
	 */
	async #module(
		pkg: Package,
		specifier: string,
		subpath: string,
		module: BaseModule,
		errors: IDiagnostic[]
	): Promise<IArtifact | undefined> {
		const { conditions } = this.#options;

		await module.conditionals.ready;
		if (!module.conditionals.has(this.key)) {
			const code = 'CONDITIONAL_NOT_FOUND';
			const declared = [...module.conditionals.keys()].join(', ');
			const message = `Module "${specifier}" does not produce the "${this.key}" conditional (declared: ${declared})`;
			errors.push({ code, message });
			return;
		}

		const conditional = <ESMConditional>module.conditionals.get(this.key);
		await conditional.ready;
		if (!conditional.valid || !conditional.output) {
			const prefix = `Module "${specifier}": `;
			conditional.errors.forEach(({ code, message }) => errors.push({ code, message: prefix + message }));

			// A conditional is invalid without diagnostics only if one of its producers failed to report one
			!conditional.errors.length &&
				errors.push({ code: 'OUTPUT_MISSING', message: `Module "${specifier}" did not produce its output` });
			return;
		}

		const { artifact: assembled } = conditional;
		const dependencies = await this.#dependencies.resolve(pkg, assembled.dependencies, errors);

		const file = this.#file(pkg, subpath, false);
		const patch = this.#file(pkg, subpath, true);
		await this.#write(conditional, file, patch);

		return {
			specifier,
			vspecifier: assembled.vspecifier,
			package: pkg.name,
			version: pkg.version,
			subpath,
			conditions,
			file,
			patch,
			hash: conditional.output.hash,
			exports: assembled.exports,
			ims: assembled.ims,
			dependencies
		};
	}

	/**
	 * Writes the artifact of a conditional, its source map and its update
	 */
	async #write(conditional: ESMConditional, file: string, patch: string): Promise<void> {
		const { path } = this.#options;
		const target = join(path, file);
		await fs.mkdir(dirname(target), { recursive: true });

		/**
		 * The source map is written next to the artifact and referenced by it. The reference comment is
		 * assembled from its parts because a literal one in this source would be consumed by the compiler
		 * that packages this implementation.
		 */
		const reference = `${['//#', 'sourceMappingURL'].join(' ')}=${posix.basename(file)}.map`;
		await fs.writeFile(target, `${conditional.output.code()}\n${reference}\n`);
		await fs.writeFile(`${target}.map`, conditional.output.map());

		// The update carries its map inline: it is imported by URL, with no sibling file to resolve
		await fs.writeFile(join(path, patch), conditional.patch.code('sourcemap-inline'));
	}
}
