import { Info, LocatorResult } from '../types';

export async function gitlab(info: Info, token?: string): Promise<LocatorResult> {
	const parts = info.name.split('/');
	if (parts.length !== 2) {
		return { error: { code: 'INVALID_REPO', text: 'Expected format gitlab:group/repo@version' } };
	}

	const [group, repo] = parts;
	const tag = `v${info.version}`;
	const file = `${repo}-${info.version}.tgz`;
	const url = `https://gitlab.com/${group}/${repo}/-/releases/${tag}/downloads/${file}`;
	const headers = token ? { Authorization: `Bearer ${token}` } : {};
	return { url, headers };
}
