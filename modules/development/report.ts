import type { ILocatedDiagnostic, IProducedDiagnostic, Located } from './located';

/**
 * The diagnostics of one build, each problem listed once.
 *
 * A diagnostic is the problem of one place: two reports of the same file, range and message are one,
 * whichever platform or public module met it (a source that two modules compile, a module checked by another
 * that imports it). A syntax error is reported by the transformation that produces the artifact and again by
 * the type check, with the same file, range and message under another code: it is listed once, as the
 * transformation's. The message of each diagnostic starts with the versioned specifier of the module that
 * reported it first; `modules` names the others, so a consumer that looks for the diagnostics of a module finds
 * it under every one of them.
 */
export class Report {
	static SYNTAX = 'TRANSPILE_ERROR';

	#located: Located;
	#items: ILocatedDiagnostic[] = [];
	#keys = new Map<string, ILocatedDiagnostic>();

	get items(): ILocatedDiagnostic[] {
		return this.#items;
	}

	constructor(located: Located) {
		this.#located = located;
	}

	/**
	 * What identifies a problem: where it is and what it says, without the module that reported it. A diagnostic
	 * without a place is identified by its code and its message.
	 */
	#key({ file, range }: ILocatedDiagnostic, code: string, message: string): string {
		return file && range ? `${file}:${range.line}:${range.column}\n${message}` : `${code}\n${message}`;
	}

	add(vspecifier: string, diagnostic: IProducedDiagnostic, severity: 'error' | 'warning' = 'error') {
		const located = this.#located.of({ ...diagnostic, message: `${vspecifier}: ${diagnostic.message}` }, severity);
		const key = this.#key(located, diagnostic.code, diagnostic.message);
		const known = this.#keys.get(key);

		if (!known) {
			this.#keys.set(key, located);
			this.#items.push(located);
			return;
		}

		// The same problem: the transformation's code wins, and each module is named once
		located.code === Report.SYNTAX && (known.code = Report.SYNTAX);

		const first = known.message.slice(0, known.message.indexOf(': '));
		if (vspecifier === first || known.modules?.includes(vspecifier)) return;
		known.modules = [...(known.modules ?? []), vspecifier];
	}

	/**
	 * A failure of the build itself, not of a module
	 */
	fail(code: string, message: string) {
		this.#items.push({ code, message, severity: 'error' });
	}
}
