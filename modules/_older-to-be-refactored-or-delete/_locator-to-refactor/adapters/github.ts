import { IInfo, ILocatorResult } from './types';

export function github(info: IInfo, auth?: { user?: string; token: string }): ILocatorResult {
	const parts = info.name.split('/');
	if (parts.length !== 2) {
		return { error: { code: 'INVALID_REPO', text: 'Expected format github:user/repo@version' } };
	}
	const [user, repo] = parts;
	const tag = `v${info.version}`;
	const file = `${repo}-${info.version}.tgz`;
	const url = `https://github.com/${user}/${repo}/releases/download/${tag}/${file}`;

	const headers: Record<string, string> = auth
		? { Authorization: `Bearer ${auth.token}`, Accept: 'application/octet-stream' }
		: {};

	return { url, headers };
}
