import { ErrorManager } from '@beyond-js/response/main';

const is = 'packages-providers-error';

export /*bundle*/ class ProvidersErrorManager extends ErrorManager {
	get is(): typeof is {
		return is;
	}

	static get is(): typeof is {
		return is;
	}
}
