import { Info, LocatorResult } from '../types';

export async function direct(info: Info): Promise<LocatorResult> {
	if (!info.ref) {
		return { error: { code: 'INVALID_URL', text: 'Missing direct URL' } };
	}
	return { url: info.ref, headers: {} };
}
