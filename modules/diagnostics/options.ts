import type { IDiagnosticsConditions, IModuleInput } from './types';
import type { Paths } from './paths';
import type { Files } from './files';
import type { Resolver } from './resolver';
import * as ts from 'typescript';
import { posix } from 'path';

/**
 * TS18003 reports that a configuration file selects no inputs. The inputs of a check are the sources of the
 * module, never the `include` of a configuration file.
 */
const IGNORED = [18003];

/**
 * The compiler options of one check.
 *
 * The strictness is the one the module declares: its own `tsconfig.json`, else the one of its package. Only
 * a module that declares no configuration is checked with `strict`, which is what the compiler itself
 * recommends for new code. Unless the configuration says otherwise, every source is an isolated module,
 * because that is how generation transforms them. Whatever the configuration says, a check emits nothing
 * and reads types only from the locations it is allowed to read.
 */
export class Options {
	#value: ts.CompilerOptions;
	get value(): ts.CompilerOptions {
		return this.#value;
	}

	#diagnostics: ts.Diagnostic[] = [];

	/**
	 * What is wrong with the configuration itself
	 */
	get diagnostics(): ts.Diagnostic[] {
		return this.#diagnostics;
	}

	#origin = 'defaults';

	/**
	 * The configuration that applied: a file relative to the package, `inline` or `defaults`
	 */
	get origin(): string {
		return this.#origin;
	}

	constructor(
		module: IModuleInput,
		directory: string,
		paths: Paths,
		files: Files,
		resolver: Resolver,
		conditions: IDiagnosticsConditions
	) {
		const declared = this.#declared(module, directory, paths, files);
		const defaults: ts.CompilerOptions = {
			target: ts.ScriptTarget.ES2022,
			module: ts.ModuleKind.ESNext,
			isolatedModules: true,
			skipLibCheck: true,
			jsx: ts.JsxEmit.React
		};

		// A declared configuration owns its strictness, including the choice of not being strict
		this.#origin === 'defaults' && (defaults.strict = true);
		const value: ts.CompilerOptions = Object.assign(defaults, declared);

		// The resolution that reads package `exports` requires an ES module kind, so it is only a default for one
		const kinds = [
			ts.ModuleKind.CommonJS,
			ts.ModuleKind.AMD,
			ts.ModuleKind.UMD,
			ts.ModuleKind.System,
			ts.ModuleKind.None
		];
		if (value.moduleResolution === void 0 && !kinds.includes(value.module)) {
			value.moduleResolution = ts.ModuleResolutionKind.Bundler;
		}

		const conditional = [
			ts.ModuleResolutionKind.Bundler,
			ts.ModuleResolutionKind.Node16,
			ts.ModuleResolutionKind.NodeNext
		];
		if (conditional.includes(value.moduleResolution) && !value.customConditions) {
			const { platform, environment } = conditions;
			value.customConditions = <string[]>[platform === 'web' ? 'browser' : platform, environment].filter(Boolean);
		}

		// A check produces diagnostics only: whatever concerns emitted files is removed
		const emission = [
			'outDir',
			'outFile',
			'rootDir',
			'declarationDir',
			'tsBuildInfoFile',
			'sourceMap',
			'inlineSourceMap'
		];
		emission
			.concat(['declaration', 'declarationMap', 'emitDeclarationOnly', 'incremental', 'composite'])
			.forEach(option => delete value[option]);
		value.noEmit = true;

		// Global types come from the supplied locations, never from the directories above the package
		value.typeRoots = resolver.roots.map(root => `${root}/@types`);
		if (!value.types) {
			const automatic = ts.getAutomaticTypeDirectiveNames(value, {
				directoryExists: name => files.directory(name),
				getDirectories: name => files.directories(name),
				fileExists: name => files.exists(name),
				readFile: name => files.read(name),
				getCurrentDirectory: () => paths.root
			});
			value.types = [...new Set([...automatic, ...resolver.ambient])];
		}

		this.#value = value;
	}

	/**
	 * The options the module or its package declares
	 */
	#declared(module: IModuleInput, directory: string, paths: Paths, files: Files): ts.CompilerOptions {
		const { tsconfig } = module;

		if (tsconfig && typeof tsconfig === 'object') {
			this.#origin = 'inline';
			const { options, errors } = ts.convertCompilerOptionsFromJson(tsconfig.compilerOptions ?? {}, paths.root);
			this.#diagnostics.push(...errors);
			return options;
		}

		const candidates =
			typeof tsconfig === 'string'
				? [paths.absolute(tsconfig)]
				: [`${directory}/tsconfig.json`, `${paths.root}/tsconfig.json`];
		const file = candidates.find(candidate => candidate && files.exists(candidate));
		if (!file) {
			if (typeof tsconfig !== 'string') return {};

			const messageText = `Configuration file "${paths.clean(tsconfig)}" was not found in the package`;
			const category = ts.DiagnosticCategory.Error;
			this.#diagnostics.push({ category, code: 5083, messageText, file: void 0, start: void 0, length: void 0 });
			return {};
		}

		this.#origin = paths.name(file);
		const read = ts.readConfigFile(file, name => files.read(name));
		if (read.error) {
			this.#diagnostics.push(read.error);
			return {};
		}

		// The host lists no directory: the inputs of the check are the sources of the module
		const host: ts.ParseConfigHost = {
			useCaseSensitiveFileNames: true,
			readDirectory: () => [],
			fileExists: name => files.exists(name),
			readFile: name => files.read(name)
		};
		const parsed = ts.parseJsonConfigFileContent(read.config, host, posix.dirname(file), void 0, file);
		this.#diagnostics.push(...parsed.errors.filter(error => !IGNORED.includes(error.code)));
		return parsed.options;
	}
}
