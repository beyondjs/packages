import { ErrorManager } from '@beyond-js/response/main';

export /*bundle*/ class HTTPErrorManager extends ErrorManager {
	get is(): 'cdn-http-error' {
		return 'cdn-http-error';
	}

	static get is(): 'cdn-http-error' {
		return 'cdn-http-error';
	}
}
