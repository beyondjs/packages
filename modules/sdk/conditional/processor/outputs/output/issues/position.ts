export interface IPosition {
	line?: number;
	column?: number;
	start?: number;
	end?: number;
}

export class Position implements IPosition {
	#is: 'range' | 'position';
	get is() {
		return this.#is;
	}

	#line: number;
	get line() {
		return this.#line;
	}
	#column: number;
	get column() {
		return this.#column;
	}

	#start: number | undefined;
	get start() {
		return this.#start;
	}
	#end: number | undefined;
	get end() {
		return this.#end;
	}

	constructor({ line, column, start, end }: IPosition) {
		// Infer the type based on the presence of start and end or just line and column
		this.#is = start || end ? 'range' : 'position';

		this.#line = line;
		this.#column = column;
		this.#start = start;
		this.#end = end;
	}
}
