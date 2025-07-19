import type { ILogger } from './types';
import { Logging, type Log } from '@google-cloud/logging';
import { v4 as uuid } from 'uuid';

const logging = new Logging();

export class Logger implements ILogger {
	#id = uuid();
	get id(): string {
		return this.#id;
	}

	#log: Log;

	async init() {
		this.#log = logging.log(`BeyondCloud/${this.#id}`);
	}

	info(message: string, meta?: any) {
		this.#write('INFO', message, meta);
	}

	warn(message: string, meta?: any) {
		this.#write('WARNING', message, meta);
	}

	error(message: string, meta?: any) {
		this.#write('ERROR', message, meta);
	}

	debug(message: string, meta?: any) {
		this.#write('DEBUG', message, meta);
	}

	#write(severity: string, message: string, meta?: any) {
		if (!this.#log) {
			console.error('Logger not initialized. Call init() before logging.');
			return;
		}

		const entry = this.#log.entry(
			{ severity },
			{
				message,
				...(meta ? { meta } : {})
			}
		);

		this.#log.write(entry).catch(error => console.error('Failed to save log:', error));
	}
}
