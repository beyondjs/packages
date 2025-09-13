import type { CodeOutputType, MapType } from './code';
import type { DynamicFile } from '@beyond-js/file/dynamic';
import { CodeOutput } from './code';
import { IssuesOutput } from './issues';

export /*bundle*/ class Output {
	#source?: DynamicFile;
	get source() {
		return this.#source;
	}

	#code: CodeOutput;
	code(output: CodeOutputType) {
		return this.#code.code(output);
	}
	map(format: MapType) {
		return this.#code.map(format);
	}

	#issues = new IssuesOutput();
	get issues() {
		return this.#issues;
	}

	constructor(source?: DynamicFile) {
		this.#source = source;
	}
}
