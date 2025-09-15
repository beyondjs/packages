import type { ILogger, ILoggerOptions } from '@beyond-js/packages/logs/types';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import { join } from 'path';

const { mkdir, appendFile } = fs.promises;

const ROOT = join(process.cwd(), '.beyond/logs');

function now(): string {
	return new Date().toISOString();
}

export /*bundle*/ class Logger implements ILogger {
	#options: ILoggerOptions;

	#id: string;
	get id(): string {
		return this.#id;
	}

	#file: string;
	get file(): string {
		return this.#file;
	}

	constructor(options: ILoggerOptions = {}) {
		this.#id = randomUUID();
		this.#file = join(ROOT, `${this.#id}.log`);
		console.log(`Logger file: ${this.#file}`);
		this.#options = options;
	}

	/**
	 * Initializes the logger by creating the logs directory if it doesn't exist.
	 */
	async init() {
		await mkdir(ROOT, { recursive: true });
	}

	info(text: string, meta?: any, id?: string): void {
		this.#write('info', text, meta, id);
	}

	warn(text: string, meta?: any, id?: string): void {
		this.#write('warn', text, meta, id);
	}

	error(text: string, meta?: any, id?: string): void {
		this.#write('error', text, meta, id);
	}

	debug(text: string, meta?: any, id?: string): void {
		this.#write('debug', text, meta, id);
	}

	#write(level: string, text: string, meta?: any, id?: string) {
		const data: { time: string; level: string; text: string; meta?: any } = {
			time: now(),
			level,
			text,
			...(meta ? { meta } : {})
		};

		// Log to console if the option is enabled
		this.#options.console && console.log(`[${data.time}] [${level}] ${text}`);

		// Append the log entry to the file
		const line = JSON.stringify(data) + '\n';
		appendFile(this.#file, line, 'utf8').catch(error => console.error('Failed to save log:', error));
	}
}
