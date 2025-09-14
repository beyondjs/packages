import type { CodeOutputType, MapType } from './code';
import type { DynamicFile } from '@beyond-js/file/dynamic';
import { CodeOutput } from './code';
import { IssuesOutput } from './issues';

export /*bundle*/ class ProcessorOutput {
	#source?: DynamicFile;
	get source() {
		return this.#source;
	}

	#code: CodeOutput = new CodeOutput();
	get code() {
		return this.#code;
	}

	#issues = new IssuesOutput();
	get issues() {
		return this.#issues;
	}

	constructor(source?: DynamicFile) {
		this.#source = source;
	}
}
