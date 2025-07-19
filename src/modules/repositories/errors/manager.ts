import { ErrorManager } from '@beyond-js/response/main';

const is = 'packages-repositories-error';

export /*bundle*/ class RepositoriesErrorManager extends ErrorManager {
	get is(): typeof is {
		return is;
	}

	static get is(): typeof is {
		return is;
	}
}
