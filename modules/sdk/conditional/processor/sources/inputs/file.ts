import type { ProcessorInputs } from './';
import type { FileData } from '@beyond-js/file/data';
import { DynamicFile } from '@beyond-js/file/dynamic';

/**
 * One source file processed by a conditional processor.
 *
 * A dynamic file subscribes to changes only when it receives both the watcher client and the listener of
 * its collection; with the listener alone it is read once and never invalidated again. This item supplies
 * both, which is what makes editing a source reprocess its module and regenerate the artifact.
 */
export class ProcessorInput extends DynamicFile {
	get dp() {
		return 'processor.input';
	}

	#inputs: ProcessorInputs;
	get inputs() {
		return this.#inputs;
	}

	constructor(inputs: ProcessorInputs, file: FileData) {
		super({ file, watcher: inputs.watcher, listener: inputs.listener });
		this.#inputs = inputs;
	}
}
