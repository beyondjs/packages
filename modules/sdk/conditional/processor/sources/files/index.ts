import type { ConditionalProcessor } from '../../';
import type { IProcessorSourcesFileStrategy } from '../../types';
import type { IDynamicFileSpec } from '@beyond-js/file/dynamic';
import { FileData } from '@beyond-js/file/data';
import { DynamicFile, DynamicFileObject } from '@beyond-js/file/dynamic';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';
import { join } from 'path';

/**
 * The auxiliary files a processor declares in its strategy, such as its `tsconfig.json`, watched like the
 * sources: editing one of them reprocesses the processor.
 *
 * Each file is located inside the module directory, which is its root, so its relative name is the name
 * the strategy declared. An earlier version joined the file name twice (`tsconfig.json/tsconfig.json`),
 * which made every auxiliary file absent.
 */
export class ProcessorFiles extends DynamicProcessor(Map<string, DynamicFile | DynamicFileObject>) {
	get dp() {
		return 'processor.files';
	}

	#processor;
	get processor() {
		return this.#processor;
	}

	constructor(processor: ConditionalProcessor, files: IProcessorSourcesFileStrategy[]) {
		super();
		this.#processor = processor;

		const error = `Processor strategy on processor "${processor.name}" is invalid`;
		if (!(files instanceof Array)) throw new Error(`${error}: files sources must be an array`);

		files.forEach(({ File, file, json }) => {
			if (File && typeof File !== 'function') throw new Error(`${error}: File item must be a function`);
			if (typeof file !== 'string' || !file) throw new Error(`${error}: file property of file item must be set`);

			const { module } = this.#processor.conditional;
			const root = join(module.package.path, module.spec.path ?? '');
			const fdata = new FileData(root, join(root, file));

			File = File || (json ? DynamicFileObject : DynamicFile);
			const spec: IDynamicFileSpec = { file: fdata, watcher: module.package.watcher };
			this.set(file, new File(spec));
		});
	}

	destroy() {
		super.destroy();
		this.forEach(file => file.destroy());
		this.clear();
	}
}
