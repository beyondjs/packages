import type { IApplicationsDiagnostic } from './types';

/**
 * The diagnostics found while reading one part of the declaration, in the order they were found
 */
export class Diagnostics {
	#list: IApplicationsDiagnostic[] = [];
	get list(): IApplicationsDiagnostic[] {
		return [...this.#list];
	}

	/**
	 * Whether an error was found
	 */
	get failed(): boolean {
		return this.#list.some(({ severity }) => severity === 'error');
	}

	error(code: string, message: string, field?: string): void {
		this.#list.push({ code, message, severity: 'error', ...(field ? { field } : {}) });
	}

	warning(code: string, message: string, field?: string): void {
		this.#list.push({ code, message, severity: 'warning', ...(field ? { field } : {}) });
	}
}
