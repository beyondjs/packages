import type { IDiagnosticsRequest, IDiagnosticsResult, IOutcome } from './types';
import { Paths } from './paths';
import { Budget, Exhausted } from './budget';
import { Files } from './files';
import { Resolver } from './resolver';
import { Options } from './options';
import { Host } from './host';
import { Report } from './report';
import * as ts from 'typescript';
import { posix } from 'path';

/**
 * Thrown while the request is read, when it does not describe a module that can be checked
 */
class Invalid extends Error {}

/**
 * One semantic check of one public module: a real program of the compiler over the sources of the module,
 * with the types of its public dependencies, that emits nothing.
 *
 * Whatever happens is a result: a problem of the code is a diagnostic, and a request that cannot be checked,
 * an exhausted budget or an unexpected failure of the compiler is an outcome. Nothing is thrown to the caller.
 */
export class Check {
	#request: IDiagnosticsRequest;
	#budget: Budget;
	#paths: Paths;
	#report: Report;
	#phases = { setup: 0, create: 0, check: 0 };
	#program: { configuration: string; strict: boolean; sources: number; dependencies: number; libraries: number } = {
		configuration: 'defaults',
		strict: false,
		sources: 0,
		dependencies: 0,
		libraries: 0
	};

	constructor(request: IDiagnosticsRequest) {
		this.#request = request;
		this.#budget = new Budget(request?.limits, request?.signal);
	}

	async run(): Promise<IDiagnosticsResult> {
		let outcome: IOutcome;

		try {
			await this.#run();
		} catch (error) {
			const cancelled = error instanceof Exhausted || error instanceof ts.OperationCanceledException;
			if (cancelled && this.#budget.outcome) outcome = this.#budget.outcome;
			else if (error instanceof Invalid) outcome = { code: 'DIAGNOSTICS_INPUT_INVALID', message: error.message };
			else
				outcome = {
					code: 'DIAGNOSTICS_FAILED',
					message: this.#clean(`The compiler failed: ${error?.message}`)
				};
		}

		const diagnostics = this.#report?.diagnostics ?? [];
		const summary = this.#report?.summary ?? {
			errors: 0,
			warnings: 0,
			unresolved: [],
			withheld: 0,
			truncated: false
		};
		const program = Object.assign({ typescript: ts.version }, this.#program, { phases: this.#phases });
		const measured = { ms: this.#budget.elapsed, files: this.#budget.loaded, program };

		return outcome
			? { complete: false, outcome, diagnostics, summary, measured }
			: { complete: true, diagnostics, summary, measured };
	}

	#clean(text: string): string {
		return this.#paths ? this.#paths.clean(text) : 'The request could not be read';
	}

	/**
	 * Reads the identity of the module, which is everything the check trusts to be well formed
	 */
	#module() {
		const { module, conditions } = this.#request ?? <IDiagnosticsRequest>{};
		const text = (value: unknown) => typeof value === 'string' && !!value;

		if (!module || typeof module !== 'object') throw new Invalid('The module to check is required');
		if (!text(module.package)) throw new Invalid('The name of the package of the module is required');
		if (!text(module.subpath)) throw new Invalid('The subpath of the module is required');
		if (!Paths.absolute(module.root)) throw new Invalid('The root of the package must be an absolute directory');
		if (!text(module.entry)) throw new Invalid('The entry point of the module is required');
		if (!conditions || !text(conditions.platform)) throw new Invalid('The platform condition is required');

		return { module, conditions };
	}

	async #run(): Promise<void> {
		let mark = performance.now();
		const lap = (phase: 'setup' | 'create' | 'check') => {
			this.#phases[phase] = performance.now() - mark;
			mark = performance.now();
		};

		const { module, conditions } = this.#module();
		const paths = (this.#paths = new Paths(module.root));
		const files = new Files(paths, this.#request.sources);
		this.#report = new Report(paths, this.#budget.diagnostics);
		this.#budget.verify();

		const entry = paths.absolute(module.entry);
		if (!entry || !files.exists(entry))
			throw new Invalid(`The entry point "${module.entry}" is not a file of the package`);

		const directory = paths.absolute(module.path ?? posix.dirname(module.entry.replace(/\\/g, '/'))) ?? paths.root;
		const sources = this.#sources(files, directory, entry);

		const resolver = new Resolver(module, paths, files, conditions, this.#request.dependencies);
		const options = new Options(module, directory, paths, files, resolver, conditions);
		const host = new Host(options.value, paths, files, this.#budget, resolver, sources);
		Object.assign(this.#program, {
			configuration: options.origin,
			strict: !!options.value.strict,
			sources: sources.length
		});
		lap('setup');

		const program = ts.createProgram({ rootNames: sources, options: options.value, host });
		const loaded = program.getSourceFiles();
		this.#program.libraries = loaded.filter(file => host.library(file.fileName)).length;
		this.#program.dependencies = loaded.length - this.#program.libraries - sources.length;
		lap('create');

		const { token } = this.#budget;
		const general = [...program.getOptionsDiagnostics(token), ...program.getGlobalDiagnostics(token)];
		this.#report.add('options', [...options.diagnostics, ...general]);

		// Only the sources of the module are checked: a dependency is read for its types, and its own problems
		// belong to the check of the module that owns it
		const checked = sources.map(source => program.getSourceFile(source)).filter(Boolean);
		checked.forEach(source => this.#report.add('syntactic', program.getSyntacticDiagnostics(source, token)));

		for (const source of checked) {
			await this.#budget.pause();
			this.#report.add('semantic', program.getSemanticDiagnostics(source, token));
		}
		lap('check');
	}

	/**
	 * The absolute sources of the module: those its description lists, or those found in its directory
	 */
	#sources(files: Files, directory: string, entry: string): string[] {
		const { module } = this.#request;
		if (!Array.isArray(module.files)) {
			const found = files.sources(directory, this.#budget);
			if (found.includes(entry)) return found;

			// An entry point outside the module directory is still a source of the module
			this.#budget.count();
			return [entry, ...found];
		}

		const listed = module.files.map(relative => {
			const file = this.#paths.absolute(relative);
			if (!file || !files.exists(file))
				throw new Invalid(`The source "${this.#clean(String(relative))}" is not a file of the package`);
			return file;
		});

		const sources = [...new Set([entry, ...listed])];
		this.#budget.count(sources.length);
		return sources;
	}
}
