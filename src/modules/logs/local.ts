import { save } from './save';
import type { Logger } from './type';

function now(): string {
	return new Date().toISOString();
}

export class Local implements Logger {
	async info(text: string, meta?: any, id?: string): Promise<void> {
		await this.write('info', text, meta, id);
	}

	async warn(text: string, meta?: any, id?: string): Promise<void> {
		await this.write('warn', text, meta, id);
	}

	async error(text: string, meta?: any, id?: string): Promise<void> {
		await this.write('error', text, meta, id);
	}

	async debug(text: string, meta?: any, id?: string): Promise<void> {
		await this.write('debug', text, meta, id);
	}

	private async write(level: string, text: string, meta?: any, id?: string): Promise<void> {
		const data = {
			time: now(),
			level,
			text,
			meta: meta ?? undefined
		};

		console.log(`[${data.time}] [${level}] ${text}`);
		await save(data, id);
	}
}
