import type { ILogger } from './types';
import { PendingPromise } from '@beyond-js/pending-promise/main';

export /*bundle*/ class Logger implements ILogger {
	static Logger: new () => ILogger;

	static async init(): Promise<void> {
		if (this.Logger) return;

		const mode = process.env.LOG_MODE === 'cloud' ? 'cloud' : 'local';
		const module = await (mode === 'cloud' ? import('./cloud') : import('./local'));
		this.Logger = module.Logger;
	}

	#ready?: PendingPromise<void>;
	#logger?: ILogger;

	get id(): string {
		return this.#logger?.id || '';
	}

	constructor() {
		// Automatically initialize the logger when the class is instantiated
		this.init();
	}

	/**
	 * Logger is automatically initialized when the class is instantiated.
	 * If you need to ensure the logger is ready before using it, you can await the
	 * `ready` property.
	 */
	async init(): Promise<void> {
		if (this.#ready) throw new Error('Logger already initialized');
		this.#ready = new PendingPromise<void>();

		try {
			await Logger.init();
			this.#logger = new Logger.Logger();
			await this.#logger.init();
		} catch (error) {
			this.#logger = void 0;
			console.error('Failed to initialize logger:', error);
		}

		this.#ready.resolve();
	}

	/* Implemente ILogger methods here if needed */
	info(text: string, meta?: any, id?: string): void {
		this.#ready!.then(() => {
			this.#logger!.info(text, meta, id);
		});
	}
	warn(text: string, meta?: any, id?: string): void {
		this.#ready!.then(() => {
			this.#logger!.warn(text, meta, id);
		});
	}
	error(text: string, meta?: any, id?: string): void {
		this.#ready!.then(() => {
			this.#logger!.error(text, meta, id);
		});
	}
	debug(text: string, meta?: any, id?: string): void {
		this.#ready!.then(() => {
			this.#logger!.debug(text, meta, id);
		});
	}
}
