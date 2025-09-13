import type { IProcessorDiagnostic } from './issue';
import { IssuesList } from './list';

export type ListType = 'errors' | 'warnings';

export class IssuesOutput {
	#errors = new IssuesList('errors');
	get errors() {
		return this.#errors;
	}

	#warnings = new IssuesList('warnings');
	get warnings() {
		return this.#warnings;
	}

	push(type: ListType, issue: IProcessorDiagnostic) {
		if (typeof type !== 'string' || !issue || typeof issue !== 'object') {
			throw new Error('Invalid parameters provided to push method.');
		}

		if (type === 'errors') {
			this.#errors.push(issue);
		} else if (type === 'warnings') {
			this.#warnings.push(issue);
		} else {
			throw new Error(`Unknown issue type: ${type}`);
		}
	}
}
