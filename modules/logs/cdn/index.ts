import type { ILogger, ILoggerOptions } from '@beyond-js/packages/logs/types';
import { Logging, type Log } from '@google-cloud/logging';
import { randomUUID } from 'crypto';

const logging = new Logging();

export /*bundle*/ class Logger implements ILogger {
	#options: ILoggerOptions;

	#id = randomUUID();
	get id(): string {
		return this.#id;
	}

	#log: Log;

	constructor(options: ILoggerOptions = {}) {
		this.#id = randomUUID();
		this.#options = options;

		// To avoid unused variable warnings
		void this.#options;
	}

	async init() {
		this.#log = logging.log(`BeyondCDN/${this.#id}`);
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
