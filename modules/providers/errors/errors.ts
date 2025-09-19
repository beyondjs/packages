import { ProvidersErrorManager } from './manager';

export /*bundle*/ enum ErrorCodes {
	internalServerError = 1,
	invalidProviderResponse,
	providerResponseCouldNotBeParsed,
	errorGettingPackageVersions
}

export /*bundle*/ class InternalServerError extends ProvidersErrorManager {
	constructor(exc: Error) {
		const code = ErrorCodes.internalServerError;
		super(code, `Internal server error`, exc);
	}
}

export /*bundle*/ class InvalidProviderResponse extends ProvidersErrorManager {
	constructor(status?: number) {
		const code = ErrorCodes.invalidProviderResponse;
		super(code, 'Error fetching package from NPM repository' + ` with status: ${status}`);
	}
}

export /*bundle*/ class ProviderResponseCouldNotBeParsed extends ProvidersErrorManager {
	constructor() {
		const code = ErrorCodes.providerResponseCouldNotBeParsed;
		super(code, `Provider response couldn't be parsed`);
	}
}

export /*bundle*/ class ErrorGettingPackageVersions extends ProvidersErrorManager {
	constructor(exc: Error) {
		const code = ErrorCodes.errorGettingPackageVersions;
		super(code, `Error getting package versions`, exc);
	}
}
