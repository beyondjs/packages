import type { DynamicFileObject } from '@beyond-js/file/dynamic';
import type { IDiagnostic } from '@beyond-js/packages/types';
import * as ts from 'typescript';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import type { Graph } from './graph';

/**
 * The compiler options of the program that checks a module and emits its declarations.
 *
 * The `tsconfig.json` of the module supplies what an author decides (strictness, libraries, JSX
 * factory); the options that make the program one of Beyond are fixed here: declarations only, ES module
 * syntax with bundler resolution, no emit of code. Type roots are the `node_modules/@types` directories
 * found from the module upwards, and the one of the installation that runs Packages, so the types of
 * a framework the toolchain supplies resolve for a package that does not install them.
 *
 * With the installed graph of the workspace, no directory is searched for types: the roots are only the ones
 * the author names, and the types included are the ones the author lists or else the `@types` packages the
 * package declares and its edges reach.
 */
export class Options {
	#directory: string;
	#fallback: string;
	#graph: Graph | undefined;

	/**
	 * @param directory The module directory
	 * @param fallback A directory whose installed packages complete what the package does not install:
	 * the one Packages runs from, which in an installation holds the toolchain
	 * @param graph The installed graph of the workspace, which replaces the directories searched for types
	 */
	constructor(directory: string, fallback: string, graph?: Graph) {
		this.#directory = directory;
		this.#fallback = fallback;
		this.#graph = graph;
	}

	get #roots(): string[] {
		const roots: string[] = [];
		const climb = (from: string) => {
			for (let current = from; ; current = dirname(current)) {
				const candidate = join(current, 'node_modules', '@types');
				existsSync(candidate) && !roots.includes(candidate) && roots.push(candidate);
				if (dirname(current) === current) return;
			}
		};
		climb(this.#directory);
		climb(this.#fallback);
		return roots;
	}

	/**
	 * @param tsconfig The `tsconfig.json` of the module, when it exists
	 */
	read(tsconfig: DynamicFileObject | undefined): { options: ts.CompilerOptions; diagnostics: IDiagnostic[] } {
		const diagnostics: IDiagnostic[] = [];
		let declared: ts.CompilerOptions = {};

		if (tsconfig?.exists) {
			if (!tsconfig.valid) diagnostics.push({ code: 'TSCONFIG_INVALID', message: `tsconfig.json: ${tsconfig.errors.map(({ message }) => message).join('; ')}` });
			else {
				const converted = ts.convertCompilerOptionsFromJson(tsconfig.value?.compilerOptions ?? {}, this.#directory, 'tsconfig.json');
				converted.errors.forEach(error => diagnostics.push({ code: 'TSCONFIG_INVALID', message: ts.flattenDiagnosticMessageText(error.messageText, '\n') }));
				declared = converted.options;
			}
		}

		const { types, typeRoots, ...kept } = declared;
		const options: ts.CompilerOptions = {
			...kept,
			target: ts.ScriptTarget.ES2022,
			module: ts.ModuleKind.ESNext,
			moduleResolution: ts.ModuleResolutionKind.Bundler,
			jsx: declared.jsx ?? ts.JsxEmit.React,
			declaration: true,
			emitDeclarationOnly: true,
			noEmit: false,
			noEmitOnError: false,
			skipLibCheck: true,
			isolatedModules: false,
			resolveJsonModule: true,
			allowJs: false,
			// The roots the author names, then the ones found from the module and from the installation; through
			// the installed graph nothing is searched for, and the types included are named
			typeRoots: [...(typeRoots ?? []), ...(this.#graph ? [] : this.#roots)],
			...(types ? { types } : this.#graph ? { types: this.#graph.types() } : {})
		};
		return { options, diagnostics };
	}
}
