import { ILogger } from './interface';
import { LocalLogger } from './local';

export async function createLogger(): Promise<ILogger> {
	const mode = process.env.LOG_MODE || 'local';

	if (mode === 'gcp') {
		try {
			const { GCPLogger } = await import('./gcp');
			return new GCPLogger();
		} catch (err) {
			console.warn('Falling back to local logger. GCP module not loaded.', err);
			return new LocalLogger();
		}
	}

	return new LocalLogger();
}
