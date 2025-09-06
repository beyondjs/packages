import type { CodeOutputType, MapType } from './code';
import { Code } from './code';
import { Issues } from './issues';

export class CompiledArtifact {
	#source;
	get source() {
		return this.#source;
	}

	#issues = new Issues();
	get issues() {
		return this.#issues;
	}

	#code: Code;
	code(output: CodeOutputType) {
		return this.#code.code(output);
	}

	map(format: MapType) {
		return this.#code.map(format);
	}

	constructor(source) {
		this.#source = source;
	}
}
