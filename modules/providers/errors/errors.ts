import { ProvidersErrorManager } from './manager';

export /*bundle*/ enum ErrorCodes {
	internalServerError = 1,
	invalidRegistryResponse,
	registryResponseCouldNotBeParsed,
	errorGettingPackageVersions
}

export /*bundle*/ class InternalServerError extends ProvidersErrorManager {
	constructor(exc: Error) {
		const code = ErrorCodes.internalServerError;
		super(code, `Internal server error`, exc);
	}
}

export /*bundle*/ class InvalidRegistryResponse extends ProvidersErrorManager {
	constructor(status?: number) {
		const code = ErrorCodes.invalidRegistryResponse;
		super(code, 'Error fetching package from NPM repository' + ` with status: ${status}`);
	}
}

export /*bundle*/ class RegistryResponseCouldNotBeParsed extends ProvidersErrorManager {
	constructor() {
		const code = ErrorCodes.registryResponseCouldNotBeParsed;
		super(code, `registry response couldn't be parsed`);
	}
}

export /*bundle*/ class ErrorGettingPackageVersions extends ProvidersErrorManager {
	constructor(exc: Error) {
		const code = ErrorCodes.errorGettingPackageVersions;
		super(code, `Error getting package versions`, exc);
	}
}
