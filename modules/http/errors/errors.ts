import { ErrorCodes as codes } from './codes';
import { HTTPErrorManager as Manager } from './manager';

export /*bundle*/ class ErrorGenerator {
	static internalError(log?: string, exc?: Error) {
		return new Manager(codes.internalError, `Internal server error ${log ? `[${log}]` : ''}`, exc);
	}
	static invalidParameter(parameter: string, type: string) {
		return new Manager(codes.invalidParameter, `Invalid parameter: "${parameter}" must be a ${type}`);
	}
	static invalidParameters(parameters: string[]) {
		return new Manager(codes.invalidParameters, `Invalid parameters: ${parameters.join(', ')}`);
	}
	static notValid() {
		return new Manager(codes.notValid, `not valid: provide "package@version"`);
	}
	static notFound() {
		return new Manager(codes.notFound, `not found`);
	}
}
