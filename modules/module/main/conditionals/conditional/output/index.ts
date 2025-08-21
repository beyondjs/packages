import type { Conditional } from '../';
import type { IDiagnostic } from '@beyond-js/packages/types';
const DynamicProcessor = require('@beyond-js/dynamic-processor');

export type OutputStrategyType = { Output: typeof Output };

export class Output extends DynamicProcessor() {
	#conditional: Conditional;
	get conditional(): Conditional {
		return this.#conditional;
	}

	#errors: IDiagnostic[] = [];
	get errors() {
		return this.#errors;
	}

	#warnings: IDiagnostic[] = [];
	get warnings(): IDiagnostic[] {
		return this.#warnings;
	}

	get valid(): boolean {
		return !this.#errors?.length;
	}

	#code: string;
	get code() {
		return this.#code;
	}

	#map: string;
	get map(): string {
		return this.#map;
	}

	constructor(conditional: Conditional, strategy: OutputStrategyType) {
		super();

		void strategy; // eslint-disable-line no-unused-vars
		this.#conditional = conditional;
	}

	_build(): { errors?: IDiagnostic[]; warnings?: IDiagnostic[]; code?: string; map?: string } {
		throw new Error(`Method '._build' must be overridden in the output processor.`);
	}

	_process() {
		const { errors, warnings, code, map } = this._build();

		this.#errors = errors || [];
		this.#warnings = warnings || [];
		this.#code = code || '';
		this.#map = map || null;
	}
}
