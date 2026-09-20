import { Digest, Media } from '@beyond-js/packages/publication';
import { Compatibility, type IKeyInputs } from '@beyond-js/packages/analysis';
import type { IOutput, IRelations } from './types';

/**
 * The outputs of one unit, each with its media type, digest and compatibility key
 */
export /*bundle*/ class Outputs {
	#inputs: Omit<IKeyInputs, 'output'>;

	#list: IOutput[] = [];
	get list(): IOutput[] {
		return this.#list;
	}

	/**
	 * @param inputs What the outputs of the unit share; the output kind completes the inputs of each key
	 */
	constructor(inputs: Omit<IKeyInputs, 'output'>) {
		this.#inputs = inputs;
	}

	/**
	 * The inputs of the key of an output kind of this unit
	 */
	inputs(output: IKeyInputs['output']): IKeyInputs {
		return <IKeyInputs>Object.assign({}, this.#inputs, { output });
	}

	key(output: IKeyInputs['output']): string {
		return Compatibility.key(this.inputs(output));
	}

	/**
	 * A source map has no key of its own: it travels with the output it describes, and carries its key
	 */
	text(kind: 'js' | 'css' | 'map', code: string, relations: IRelations = {}): void {
		const media = { js: 'text/javascript', css: 'text/css', map: 'application/json' }[kind];
		const key = this.key(kind === 'map' ? relations.of : kind);
		this.#list.push({ kind, media, code, size: Buffer.byteLength(code), digest: Digest.of(code), key, relations });
	}

	asset(path: string, bytes: Uint8Array, media?: string): void {
		this.#list.push({ kind: 'asset', media: media ?? Media.of(path), bytes, size: bytes.byteLength, digest: Digest.of(bytes), key: this.key('asset'), relations: {} });
	}
}
