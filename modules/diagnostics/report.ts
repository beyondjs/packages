import type { DiagnosticCategory, IDiagnosticsResult, ISemanticDiagnostic } from './types';
import type { Paths } from './paths';
import * as ts from 'typescript';

/**
 * The compiler codes that mean types were not available, not that the module is wrong:
 * a module or its declarations were not found (2307, 2792, 7016), a package of global types was not found
 * (2688), a global of a platform whose types are missing was used (2580, 2591, 2582, 2593, 2584, 2867, 2868),
 * and JSX was used without the types of its runtime (7026, 2875).
 */
const UNRESOLVED = [2307, 2792, 7016, 2688, 2580, 2591, 2582, 2593, 2584, 2867, 2868, 7026, 2875];

/**
 * The codes of `UNRESOLVED` that name a module, which is only a public dependency when it is a bare specifier
 */
const IMPORTS = [2307, 2792, 7016];

/**
 * The codes of an implicit `any`. What is imported from a dependency without types is `any`, and so is
 * whatever is inferred from it, such as the parameter of a callback: while the types of a dependency are
 * unresolved, these reports cannot be told apart from consequences of that, so they are withheld and counted.
 */
const IMPLICIT = [7005, 7006, 7008, 7010, 7011, 7018, 7019, 7031, 7034];

/**
 * One kept diagnostic, in the order the compiler reported it
 */
interface IEntry {
	order: number;
	item: ISemanticDiagnostic;
}

/**
 * Collects what the compiler reports about one module, as plain data that does not describe the host.
 *
 * Missing types of a public dependency are kept apart from errors of the module, as the non-fatal
 * `types-unresolved` category, and reported once per dependency: the compiler types what it could not
 * resolve as `any`, so they hide errors but never produce false ones.
 */
export class Report {
	#paths: Paths;
	#limit: number;
	#order = 0;
	#items: IEntry[] = [];
	#implicit: IEntry[] = [];
	#unresolved: Map<string, ISemanticDiagnostic> = new Map();
	#count = { errors: 0, warnings: 0, implicit: 0 };

	/**
	 * @param limit How many diagnostics the result carries; every diagnostic is counted
	 */
	constructor(paths: Paths, limit: number) {
		this.#paths = paths;
		this.#limit = limit;
	}

	/**
	 * Adds what one phase of the compiler reported
	 */
	add(category: Exclude<DiagnosticCategory, 'types-unresolved'>, diagnostics: readonly ts.Diagnostic[]): void {
		diagnostics.forEach(diagnostic => {
			const warning = diagnostic.category === ts.DiagnosticCategory.Warning;
			if (!warning && diagnostic.category !== ts.DiagnosticCategory.Error) return;

			const message = this.#paths.clean(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
			const item: ISemanticDiagnostic = {
				category,
				code: `TS${diagnostic.code}`,
				severity: warning ? 'warning' : 'error',
				message
			};
			this.#locate(item, diagnostic);

			if (this.#missing(item, diagnostic.code)) return;
			if (IMPLICIT.includes(diagnostic.code)) {
				this.#count.implicit++;
				this.#keep(this.#implicit, item);
				return;
			}

			item.severity === 'error' ? this.#count.errors++ : this.#count.warnings++;
			this.#keep(this.#items, item);
		});
	}

	/**
	 * Keeps a diagnostic while the result has room for it; the counts do not depend on it
	 */
	#keep(entries: IEntry[], item: ISemanticDiagnostic): void {
		entries.length < this.#limit && entries.push({ order: this.#order++, item });
	}

	#locate(item: ISemanticDiagnostic, { file, start, length }: ts.Diagnostic): void {
		if (!file) return;

		item.file = this.#paths.name(file.fileName);
		if (start === void 0) return;

		const position = (offset: number) => {
			const { line, character } = file.getLineAndCharacterOfPosition(offset);
			return { line, character };
		};
		item.range = { start: position(start), end: position(start + (length ?? 0)) };
	}

	/**
	 * Files a diagnostic of missing types under its own category
	 *
	 * @returns Whether the diagnostic was one of missing types
	 */
	#missing(item: ISemanticDiagnostic, code: number): boolean {
		if (!UNRESOLVED.includes(code)) return false;

		const specifier = IMPORTS.includes(code) ? item.message.match(/'([^']+)'/)?.[1] : void 0;

		// A relative import that is not found is a missing source of the module, which is its own error
		if (specifier?.startsWith('.') || specifier?.startsWith('/')) return false;

		const key = specifier ?? item.message;
		const known = this.#unresolved.get(key);
		if (known) {
			known.occurrences++;
			return true;
		}

		Object.assign(item, {
			category: 'types-unresolved',
			origin: item.code,
			code: 'TYPES_UNRESOLVED',
			severity: 'warning'
		});
		specifier && (item.specifier = specifier);
		item.occurrences = 1;

		this.#unresolved.set(key, item);
		this.#count.warnings++;
		this.#keep(this.#items, item);
		return true;
	}

	/**
	 * Whether the reports of an implicit `any` are withheld, which is while any types are unresolved
	 */
	get #withheld(): boolean {
		return this.#unresolved.size > 0;
	}

	get diagnostics(): ISemanticDiagnostic[] {
		const entries = this.#withheld ? this.#items : [...this.#items, ...this.#implicit];
		return entries
			.sort((a, b) => a.order - b.order)
			.slice(0, this.#limit)
			.map(({ item }) => item);
	}

	get summary(): IDiagnosticsResult['summary'] {
		const { implicit, warnings } = this.#count;
		const withheld = this.#withheld ? implicit : 0;
		const errors = this.#count.errors + implicit - withheld;

		const unresolved = [...this.#unresolved.values()].map(({ specifier }) => specifier).filter(Boolean);
		const truncated = errors + warnings > this.diagnostics.length;
		return { errors, warnings, unresolved: unresolved.sort(), withheld, truncated };
	}
}
