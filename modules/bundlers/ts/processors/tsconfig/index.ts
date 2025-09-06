import ts from 'typescript';
import InputFile from '@beyond-js/bundlers-sdk/bundler/processor/sources/file';
import { equal } from '@beyond-js/equal/main';

export class TsConfig extends InputFile {
	#errors = [];
	get errors() {
		return this.#errors;
	}

	#defaults;
	#value;
	get value() {
		return this.#value;
	}

	get hash() {
		const hash = super.hash;
		return hash || 1;
	}

	constructor(processor, meta) {
		super(processor, meta);

		this.#defaults = {
			incremental: true,
			module: ts.ModuleKind.ESNext,
			target: ts.ScriptTarget.ESNext,
			moduleResolution: ts.ModuleResolutionKind.NodeJs,
			sourceMap: true,
			declaration: true,
			declarationMap: true,
			inlineSources: false,
			allowSyntheticDefaultImports: true
			// noEmitOnError: true
		};
	}

	async _process(request) {
		await super._process(request);
		if (request !== this._request) return;

		if (!this.valid) {
			this.#errors = super.errors;
			this.#value = void 0;
		}

		this.#value = void 0;

		let value;
		try {
			value = this.content ? JSON.parse(this.content) : {};
			value = value.compilerOptions;
			value = value ? value : {};
			value.jsx && (value.jsx = ts.JsxEmit.React);
			delete value.paths;
			delete value.outDir;
			delete value.moduleResolution;
			value.noImplicitUseStrict = true;

			const { path } = this.processor;
			value.tsBuildInfoFile = require('path').join(path, 'tsconfig.tsbuildinfo');
		} catch (exc) {
			this.errors.push(`Error parsing tsconfig.json - ${exc.message}`);
			return;
		}

		value = Object.assign(value, this.#defaults);
		const changed = !equal(value, this.#value);
		if (!changed) return false;

		this.#value = value;
	}
}
