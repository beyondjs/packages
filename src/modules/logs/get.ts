import type { Logger } from './type';

export async function get(): Promise<Logger> {
	const mode = process.env.LOG_MODE ?? 'local';

	if (mode === 'cloud') {
		const { Cloud } = await import('./cloud');
		return new Cloud();
	}

	const { Local } = await import('./local');
	return new Local();
}
