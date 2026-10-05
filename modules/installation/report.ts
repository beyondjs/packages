import type { IInstallationDiagnostic, IInstallationReport } from './types';

/**
 * Collects what an installation did into its `beyond-installation/1` report
 */
export class Report {
	#frozen = false;
	#lock: IInstallationReport['lock'];
	#execution: IInstallationReport['execution'];
	#counts: IInstallationReport['counts'] = { members: 0, nodes: 0, fetched: 0, reused: 0 };
	#diagnostics: IInstallationDiagnostic[] = [];

	constructor(lock: string, execution: string) {
		this.#lock = { path: lock, written: false };
		this.#execution = { path: execution, written: false };
	}

	set frozen(value: boolean) {
		this.#frozen = value;
	}

	set counts(value: IInstallationReport['counts']) {
		this.#counts = { ...value };
	}

	/**
	 * Records the digest of the lock at its path, and whether this installation wrote it
	 */
	locked(digest: string | undefined, written = false): void {
		this.#lock = { path: this.#lock.path, ...(digest ? { digest } : {}), written };
	}

	projected(): void {
		this.#execution = { ...this.#execution, written: true };
	}

	add(...diagnostics: IInstallationDiagnostic[]): void {
		this.#diagnostics.push(...diagnostics);
	}

	/**
	 * Records why the installation failed, ahead of the findings that explain it, and answers the report
	 */
	fail(code: string, message: string): IInstallationReport {
		this.#diagnostics.unshift({ code, message, severity: 'error' });
		return this.build();
	}

	build(): IInstallationReport {
		const errors = this.#diagnostics.some(({ severity }) => severity === 'error');
		return {
			protocol: 'beyond-installation/1',
			valid: !errors && this.#execution.written,
			frozen: this.#frozen,
			lock: { ...this.#lock },
			execution: { ...this.#execution },
			counts: { ...this.#counts },
			diagnostics: this.#diagnostics.map(diagnostic => ({ ...diagnostic }))
		};
	}
}
