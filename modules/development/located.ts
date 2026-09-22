import { relative, sep } from 'path';

/**
 * A diagnostic as Packages' delivery produces it: the file is an absolute path when the producer knows it
 */
export /*bundle*/ interface IProducedDiagnostic {
	code: string;
	message: string;
	file?: string;
	position?: { line: number; column: number };
}

/**
 * A diagnostic as the contract carries it: the file relative to the served root, its revision, and the
 * one-based line and column
 */
export /*bundle*/ interface ILocatedDiagnostic {
	code: string;
	message: string;
	severity: 'error' | 'warning';
	file?: string;
	revision?: string;
	range?: { line: number; column: number };
}

/**
 * Locates the diagnostics of the delivery inside the served root. A file outside the root, such as one of
 * a package the toolchain supplies, is not named: the message keeps its text, and the client has no file
 * to open.
 */
export class Located {
	#root: string;
	#revision: (path: string) => string | undefined;

	/**
	 * @param root The absolute, resolved path of the served root
	 * @param revision The revision the source index holds for a contract path
	 */
	constructor(root: string, revision: (path: string) => string | undefined) {
		this.#root = root;
		this.#revision = revision;
	}

	/**
	 * The contract path of an absolute file, or undefined when it is outside the root
	 */
	path(file: string): string | undefined {
		const path = relative(this.#root, file);
		if (!path || path.startsWith('..') || path.includes(`${sep}..${sep}`)) return;
		return path.split(sep).join('/');
	}

	of(diagnostic: IProducedDiagnostic, severity: 'error' | 'warning' = 'error'): ILocatedDiagnostic {
		const { code, message, file, position } = diagnostic;
		const located: ILocatedDiagnostic = { code, message, severity };
		const path = file && this.path(file);
		if (!path) return located;

		located.file = path;
		const revision = this.#revision(path);
		revision && (located.revision = revision);
		position && (located.range = { line: position.line, column: position.column });
		return located;
	}
}
