import { IInfo, ILocatorResult } from './types';

export function npm(info: IInfo, token?: string): ILocatorResult {
	const url = `https://registry.npmjs.org/${info.name}/-/${info.name}-${info.version}.tgz`;
	const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
	return { url, headers };
}
