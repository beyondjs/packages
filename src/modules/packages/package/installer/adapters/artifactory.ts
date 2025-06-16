import { Info, LocatorResult } from '../types';

export async function artifactory(info: Info, token?: string): Promise<LocatorResult> {
	if (!info.ref) {
		return { error: { code: 'INVALID_ARTIFACTORY', text: 'Missing Artifactory URL' } };
	}

	const headers = token ? { Authorization: `Bearer ${token}` } : {};
	return { url: info.ref, headers };
}
