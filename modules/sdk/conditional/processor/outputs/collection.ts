import type { DynamicFile } from '@beyond-js/file/dynamic';
import { ProcessorOutput } from './output';

export class OutputsCollection extends Map<string, ProcessorOutput> {
	obtain(file: DynamicFile): ProcessorOutput {
		if (this.has(file.relative.file)) {
			return super.get(file.relative.file);
		}

		const output = new ProcessorOutput(file);
		super.set(file.relative.file, output);
		return output;
	}

	update(output: ProcessorOutput): void {
		if (!(output instanceof ProcessorOutput)) {
			throw new Error(`An instance of ProcessorOutput was expected`);
		}

		super.set(output.source.relative.file, output);
	}

	// hydrate(cached: Record<string, any>) {
	// 	this.#hash = cached.hash;
	// }

	// serialize(json?: Record<string, any>) {
	// 	json = json || {};
	// 	return Object.assign({ hash: this.#hash }, json);
	// }
}
