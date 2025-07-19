import type { ILogger } from './types';
import { v4 as uuid } from 'uuid';
import fs from 'fs';
import { join } from 'path';

const root = join(process.cwd(), './beyond/logs');

function now(): string {
	return new Date().toISOString();
}

export class Logger implements ILogger {
	#id: string;
	get id(): string {
		return this.#id;
	}

	#file: string;
	get file(): string {
		return this.#file;
	}

	constructor() {
		this.#id = uuid();
		this.#file = join(root, `${this.#id}.log`);
	}

	/**
	 * Initializes the logger by creating the logs directory if it doesn't exist.
	 */
	async init() {
		await fs.promises.mkdir(root, { recursive: true });
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

		console.log(`[${data.time}] [${level}] ${text}`);

		const line = JSON.stringify(data) + '\n';
		fs.promises.appendFile(this.#file, line, 'utf8').catch(error => console.error('Failed to save log:', error));
	}
}
