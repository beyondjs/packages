import type { DynamicFile } from '@beyond-js/file/dynamic';
import { Output } from './output';

export class OutputsCollection extends Map<string, Output> {
	#hash: string;
	get hash() {
		return this.#hash;
	}

	#get(file: DynamicFile): Output {
		if (this.has(file.relative.file)) {
			return super.get(file.relative.file);
		}

		const output = new Output(file);
		super.set(file.relative.file, output);
		return output;
	}

	update(output: Output): void {
		if (!(output instanceof Output)) {
			throw new Error(`An instance of Output was expected`);
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
