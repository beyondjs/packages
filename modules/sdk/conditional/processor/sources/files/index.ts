import type { Processor } from '../../';
import type { IProcessorSourcesFileStrategy } from '../../types';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';
import { DynamicFile, DynamicFileObject } from '@beyond-js/file/dynamic';

export class ProcessorSourcesFiles extends DynamicProcessor(Map<string, DynamicFile | DynamicFileObject>) {
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

		files.forEach(({ File, file, json }) => {
			if (typeof file !== 'object') throw new Error(`${error}: file item must be an object`);
			if (typeof file !== 'string' || !file) throw new Error(`${error}: file property of file item must be set`);

			File = File || (json ? DynamicFileObject : DynamicFile);
			this.set(file, new File(file));
		});
	}

	#hash;
	get hash() {
		return this.#hash;
	}
}
