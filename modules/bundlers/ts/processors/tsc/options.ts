import type { DynamicFileObject } from '@beyond-js/file/dynamic';
import type { IDiagnostic } from '@beyond-js/packages/types';
import * as ts from 'typescript';
import { existsSync } from 'fs';
import { dirname, join } from 'path';

/**
 * The compiler options of the program that checks a module and emits its declarations.
 *
 * The `tsconfig.json` of the module supplies what an author decides (strictness, libraries, JSX
 * factory); the options that make the program one of Beyond are fixed here: declarations only, ES module
 * syntax with bundler resolution, no emit of code. Type roots are the `node_modules/@types` directories
 * found from the module upwards, and the one of the installation that runs Packages, so the types of
 * a framework the toolchain supplies resolve for a package that does not install them.
 */
export class Options {
	#directory: string;
	#fallback: string;

	/**
	 * @param directory The module directory
	 * @param fallback A directory whose installed packages complete what the package does not install:
	 * the one Packages runs from, which in an installation holds the toolchain
	 */
	constructor(directory: string, fallback: string) {
		this.#directory = directory;
		this.#fallback = fallback;
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
			// The roots the author names, then the ones found from the module and from the installation
			typeRoots: [...(typeRoots ?? []), ...this.#roots],
			...(types ? { types } : {})
		};
		return { options, diagnostics };
	}
}
