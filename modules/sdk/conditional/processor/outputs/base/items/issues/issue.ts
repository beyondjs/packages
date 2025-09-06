import type { ListType } from './';
import { Position } from './position';

export /*bundle*/ interface IProcessorDiagnostic {
	code: string;
	message: string;
	position?: Position;
}

export class Issue implements IProcessorDiagnostic {
	#type;
	get type() {
		return this.#type;
	}

	#code: string;
	get code() {
		return this.#code;
	}

	#message: string;
	get message() {
		return this.#message;
	}

	#position?: Position;
	get position() {
		return this.#position;
	}

	constructor(type: ListType, { code, message, position }: IProcessorDiagnostic) {
		if (typeof type !== 'string') {
			throw new Error('Invalid parameter: type must be a string');
		}
		if (typeof code !== 'string' || typeof message !== 'string') {
			throw new Error('Invalid parameters: code and message must be strings');
		}
		if (position && typeof position !== 'object') {
			throw new Error('Invalid parameters: position must be an object');
		}

		this.#type = type;
		this.#code = code;
		this.#message = message;
		this.#position = position ? new Position(position) : void 0;
	}
}
