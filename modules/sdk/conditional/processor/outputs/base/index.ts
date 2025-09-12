import type { ConditionalProcessor } from '../..';
import type { IRequest } from '@beyond-js/dynamic-processor/main';
import type { CompiledArtifact } from './artifacts/artifact';
import { CompiledArtifacts } from './artifacts';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';

type OutputsType = 'ims' | 'types' | 'css';

export class ProcessorOutputsBase extends DynamicProcessor(Map<string, CompiledArtifact>) {
	get dp() {
		return 'processor.outputs.base';
	}

	#processor: ConditionalProcessor;
	get processor() {
		return this.#processor;
	}

	#type: OutputsType;
	get type() {
		return this.#type;
	}

	/**
	 * The hash of the sources set when the output was last built.
	 * This is used to determine if the output needs to be rebuilt.
	 */
	#hash: string;
	get hash() {
		return this.#hash;
	}

	get updated() {
		return this.#processor.sources.hash === this.#hash;
	}

	constructor(processor: ConditionalProcessor, type: OutputsType) {
		if (!processor.sources) {
			throw new Error('The processor must have sources');
		}

		super();
		this.#processor = processor;
		this.#type = type;

		super.setup(new Map([['sources', { child: processor.sources }]]));
	}

	// async _begin() {
	// 	const { store } = this.#processor.conditional;
	// 	const cached = await store.outputs.fetch(this.#processor.name, this.#type);
	// 	cached && this.hydrate(cached);
	// }

	async _build(request: IRequest, artifacts: CompiledArtifacts) {
		void request, artifacts;
		throw new Error(`Method '._build' must be overridden`);
	}

	async _process(request: IRequest) {
		void request;
		if (this.updated) return false;

		const artifacts = new CompiledArtifacts();
		await this._build(request, artifacts);
		if (request !== this._request) return;

		this.#hash = this.#processor.sources.hash;

		this.clear();
		artifacts.forEach((item, key) => this.set(key, item));
	}

	// hydrate(cached: Record<string, any>) {
	// 	this.#hash = cached.hash;
	// }

	// serialize(json?: Record<string, any>) {
	// 	json = json || {};
	// 	return Object.assign({ hash: this.#hash }, json);
	// }
}
