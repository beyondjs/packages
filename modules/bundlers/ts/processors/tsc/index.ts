import type { Conditional, ProcessorOutputs } from '@beyond-js/packages/sdk';
import type { IRequest } from '@beyond-js/dynamic-processor/main';
import type { IDiagnostic } from '@beyond-js/packages/types';
import type { DynamicFileObject } from '@beyond-js/file/dynamic';
import type { Package } from '@beyond-js/packages/package';
import { ConditionalProcessor } from '@beyond-js/packages/sdk';
import * as ts from 'typescript';
import { join, relative } from 'path';
import { Options } from './options';
import { Host } from './host';
import { Declaration } from './declaration';
import { Dependencies } from './dependencies';
import { Graph } from './graph';

/**
 * Checks the sources of a public module as one program and emits its public declaration.
 *
 * The program holds the `.ts` and `.tsx` files of the module, the synthesized declaration of every
 * framework component they import, and the declarations of the public modules of the workspace they
 * import, held in memory. Its semantic diagnostics are reported on the source files of the module with
 * their positions; diagnostics of other files (installed declarations, dependencies) are left to their
 * owners. The declarations it emits are assembled into the one declaration of the public module, which
 * is the output of the `types` conditional. With the installed graph of the workspace, the bare specifiers
 * and the types of the program are resolved through the edges of the importing packages ([Graph](./graph.ts)).
 */
export /*bundle*/ class Processor extends ConditionalProcessor {
	#dependencies: Dependencies;

	#diagnostics: IDiagnostic[] = [];
	get errors(): IDiagnostic[] {
		return this.#diagnostics.concat(super.errors);
	}

	constructor(conditional: Conditional, name: string) {
		super(conditional, name, {
			sources: {
				inputs: { extname: ['.ts', '.tsx'] },
				files: [{ file: 'tsconfig.json', json: true }]
			}
		});
		this.#dependencies = new Dependencies(this);
	}

	get #directory(): string {
		const { module } = this.conditional;
		return join(module.package.path, module.spec.path ?? '');
	}

	#position(diagnostic: ts.Diagnostic) {
		if (!diagnostic.file || diagnostic.start === void 0) return;
		const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
		return { line: line + 1, column: character + 1 };
	}

	async _build(request: IRequest, outputs: ProcessorOutputs): Promise<void> {
		const { module } = this.conditional;
		const directory = this.#directory;
		const diagnostics: IDiagnostic[] = [];

		const inputs = [...this.sources.inputs.values()].filter(input => input.valid).sort((a, b) => a.file.localeCompare(b.file));
		const roots = inputs.map(input => input.file);
		if (!roots.length) return void (this.#diagnostics = diagnostics);
		void outputs;

		// Through the installed graph of the workspace, when it has one, and never from the toolchain then. A
		// module types its package with an interface of its own; the object is the package of the workspace.
		const graph = Graph.of(<Package>(<unknown>module.package), directory);
		const { options, diagnostics: configuration } = new Options(directory, process.cwd(), graph).read(<DynamicFileObject>this.sources.files?.get('tsconfig.json'));
		configuration.forEach(diagnostic => diagnostics.push(diagnostic));

		// The declarations of the workspace modules the sources import, as ambient modules of the program
		const specifiers = Dependencies.specifiers(inputs.map(input => input.content));
		const { declarations, owners, unresolved } = await this.#dependencies.read(specifiers);
		if (request !== this._request) return;
		unresolved.forEach((reason, specifier) => diagnostics.push({ code: 'TYPES_UNRESOLVED', message: `${specifier}: ${reason}` }));

		// A package the installed graph does not have resolves nothing of another package; its own modules and
		// the builtins need no edge
		const foreign = graph && !graph.member ? Graph.foreign(specifiers, module.package.name) : [];
		if (foreign.length) {
			const message = `"${module.package.vname}" (${module.package.path}) imports ${foreign.join(', ')}, but it is not a package of the installed graph: run beyond install`;
			diagnostics.push({ code: 'DEPENDENCY_NOT_INSTALLED', message });
		}

		// One file per imported specifier, numbered so that two specifiers never share a file name
		const virtual = new Map<string, string>();
		[...declarations].forEach(([specifier, code], index) => {
			const file = `${Host.VIRTUAL}${index}-${specifier.replace(/[^\w.-]/g, '_')}.d.ts`;
			virtual.set(file, code);
			graph?.own(file, owners.get(specifier));
		});

		const host = new Host(options, directory, process.cwd(), virtual, specifier => this.#dependencies.published(specifier), graph);
		const program = ts.createProgram({ rootNames: [...roots, ...virtual.keys()], options, host: host.compiler });

		const own = new Set(roots);
		const report = (diagnostic: ts.Diagnostic) => {
			const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
			const code = `TS${diagnostic.code}`;
			const kind = diagnostic.category === ts.DiagnosticCategory.Error ? 'errors' : 'warnings';
			const file = diagnostic.file?.fileName;
			if (file && own.has(file)) {
				const input = inputs.find(one => one.file === file);
				const output = outputs.types.obtain(input);
				return output.issues.push(kind, { code, message, position: this.#position(diagnostic) });
			}
			// A diagnostic of a file outside the module is its owner's, unless it is global
			!file && kind === 'errors' && diagnostics.push({ code, message });
		};

		[...program.getOptionsDiagnostics(), ...program.getGlobalDiagnostics()].forEach(report);
		roots.forEach(file => {
			const source = program.getSourceFile(file);
			if (!source) return;
			[...program.getSyntacticDiagnostics(source), ...program.getSemanticDiagnostics(source)].forEach(report);
		});

		// The declarations of the sources, assembled into the declaration of the public module
		const { entry } = <{ entry?: string }>(<unknown>this.conditional);
		const point = entry ?? module.spec.entry;
		const subpath = module.spec.subpath.replace(/^\.\/?/, '');
		const { package: pkg } = module;
		const vspecifier = subpath ? `${pkg.vname}/${subpath}` : pkg.vname;
		const specifier = subpath ? `${pkg.name}/${subpath}` : pkg.name;
		const id = (file: string) => `./${relative(directory, file).replace(/\\/g, '/').replace(/\.(d\.ts|tsx?)$/, '')}`;
		const declaration = new Declaration(specifier, vspecifier, point ? id(join(directory, point)) : './index');

		roots.forEach(file => {
			const source = program.getSourceFile(file);
			if (!source) return;
			if (file.endsWith('.d.ts')) return declaration.add(id(file), source.text);
			program.emit(source, (name, text) => name.endsWith('.d.ts') && declaration.add(id(file), text), void 0, true);
		});

		// Framework components imported by the declarations get the stub declaration the program used
		inputs.forEach(input => {
			ts.preProcessFile(input.content, true, true).importedFiles.forEach(({ fileName }) => {
				if (!fileName.startsWith('.') || !/\.(vue|svelte)$/.test(fileName)) return;
				const target = join(input.file, '..', fileName);
				declaration.add(`./${relative(directory, target).replace(/\\/g, '/')}`, Host.stub());
			});
		});

		if (request !== this._request) return;
		const target = inputs.find(input => point && input.file === join(directory, point)) ?? inputs[0];
		outputs.types.obtain(target).code.set({ code: declaration.code, map: void 0 });
		this.#diagnostics = diagnostics;
	}

	destroy() {
		super.destroy();
		this.#dependencies.destroy();
	}
}
