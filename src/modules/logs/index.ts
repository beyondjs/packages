import type { Logger } from './type';
import { get } from './get';

let logger: Logger;

export async function use(): Promise<Logger> {
	if (!logger) {
		logger = await get();
	}

	return logger;
}
