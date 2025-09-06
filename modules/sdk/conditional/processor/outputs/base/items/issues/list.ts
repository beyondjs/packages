import type { ListType } from './';
import type { IProcessorDiagnostic } from './issue';
import { Issue } from './issue';

export class IssuesList extends Array {
	#type: ListType;
	get type() {
		return this.#type;
	}

	constructor(type: ListType) {
		super();
		this.#type = type;
	}

	push(diagnostic: IProcessorDiagnostic) {
		if (typeof diagnostic !== 'object' || !diagnostic.code || !diagnostic.message) {
			throw new Error(
				'Invalid diagnostic provided to push method. Expected an object with code and message properties.'
			);
		}

		return super.push(new Issue(this.#type, diagnostic));
	}
}
