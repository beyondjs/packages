import { IInfo, ILocatorResult } from './types';

export function artifactory(info: IInfo, token?: string): ILocatorResult {
	if (!info.ref) {
		return { error: { code: 'INVALID_ARTIFACTORY', text: 'Missing Artifactory URL' } };
	}

	const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
	return { url: info.ref, headers };
}
