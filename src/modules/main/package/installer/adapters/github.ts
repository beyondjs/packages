import { Info, LocatorResult } from '../types';

export async function github(info: Info, auth?: { user?: string; token: string }): Promise<LocatorResult> {
	const parts = info.name.split('/');
	if (parts.length !== 2) {
		return { error: { code: 'INVALID_REPO', text: 'Expected format github:user/repo@version' } };
	}
	const [user, repo] = parts;
	const tag = `v${info.version}`;
	const file = `${repo}-${info.version}.tgz`;
	const url = `https://github.com/${user}/${repo}/releases/download/${tag}/${file}`;

	const headers = auth ? { Authorization: `Bearer ${auth.token}`, Accept: 'application/octet-stream' } : {};

	return { url, headers };
}
