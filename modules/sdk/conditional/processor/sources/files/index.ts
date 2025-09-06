import type { Processor } from '../../';
import type { IProcessorSourcesFileStrategy } from '../../types';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';
import { ProcessorSourcesFile } from './file';

export class ProcessorSourcesFiles extends DynamicProcessor(Map) {
	get dp() {
		return 'bundler.processor.sources.files';
	}

	#processor;
	get processor() {
		return this.#processor;
	}

	constructor(processor: Processor, files: IProcessorSourcesFileStrategy[]) {
		super();
		this.#processor = processor;

		const error = `Processor strategy on processor "${processor.name}" is invalid`;
		if (!(files instanceof Array)) throw new Error(`${error}: files sources must be an array`);

		files.forEach(({ File, file }) => {
			if (typeof file !== 'object') throw new Error(`${error}: file item must be an object`);
			if (typeof file !== 'string' || !file) throw new Error(`${error}: file property of file item must be set`);

			File = File || ProcessorSourcesFile;
			this.set(file, new File(processor, file));
		});
	}

	#hash;
	get hash() {
		return this.#hash;
	}
}
