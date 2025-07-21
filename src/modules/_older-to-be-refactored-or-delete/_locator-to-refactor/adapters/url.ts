import { IInfo, ILocatorResult } from './types';

export function direct(info: IInfo): ILocatorResult {
	if (!info.ref) {
		return { error: { code: 'INVALID_URL', text: 'Missing direct URL' } };
	}
	return { url: info.ref, headers: {} };
}
