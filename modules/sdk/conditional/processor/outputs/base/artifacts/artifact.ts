import type { CodeOutputType, MapType } from './code';
import type { DynamicFile } from '@beyond-js/file/dynamic';
import { ArtifactCode } from './code';
import { ArtifactIssues } from './issues';

export class CompiledArtifact {
	#file: DynamicFile;
	get file() {
		return this.#file;
	}

	#code: ArtifactCode;
	code(output: CodeOutputType) {
		return this.#code.code(output);
	}
	map(format: MapType) {
		return this.#code.map(format);
	}

	#issues = new ArtifactIssues();
	get issues() {
		return this.#issues;
	}

	constructor(file: DynamicFile) {
		this.#file = file;
	}
}
