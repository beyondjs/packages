import { Info, LocatorResult } from '../types';

export async function npm(info: Info, token?: string): Promise<LocatorResult> {
	const url = `https://registry.npmjs.org/${info.name}/-/${info.name}-${info.version}.tgz`;
	const headers = token ? { Authorization: `Bearer ${token}` } : {};
	return { url, headers };
}
