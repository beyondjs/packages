import type { ILogger, ILoggerOptions } from '@beyond-js/packages/logs/types';
import { PendingPromise } from '@beyond-js/pending-promise/main';

declare const bimport: (module: string) => Promise<any>;

export /*bundle*/ class Logger implements ILogger {
	static Logger: new (options: ILoggerOptions) => ILogger;

	static async init(cdn?: boolean): Promise<void> {
		const mode = cdn ? 'cdn' : 'local';
		const module = await bimport(`@beyond-js/packages/logs/${mode}`);
		Logger.Logger = module.Logger;
	}

	#options: ILoggerOptions;
	#ready?: PendingPromise<void>;
	#logger?: ILogger;

	get id(): string {
		return this.#logger?.id || '';
	}

	constructor(options: ILoggerOptions = {}) {
		if (!Logger.Logger) {
			throw new Error(
				'Logger not initialized. You must call and await Logger.init() before instantiating the Logger class.'
			);
		}

		this.#options = options;
		this.#logger = new Logger.Logger(this.#options);
		this.init();
	}

	/**
	 * Logger is automatically initialized when the class is instantiated.
	 * If you need to ensure the logger is ready before using it, you can await the
	 * `ready` property.
	 */
	async init(): Promise<void> {
		if (this.#ready) return await this.#ready;
		this.#ready = new PendingPromise<void>();

		// Initialize the logger and handle any potential errors
		try {
			await this.#logger.init();
		} catch (error) {
			this.#logger = void 0;
			console.error('Failed to initialize logger:', error);
		}

		this.#ready.resolve();
	}

	/* Implemente ILogger methods here if needed */
	info(text: string, meta?: any, id?: string): void {
		this.#ready.then(() => {
			this.#logger!.info(text, meta, id);
		});
	}
	warn(text: string, meta?: any, id?: string): void {
		this.#ready.then(() => {
			this.#logger!.warn(text, meta, id);
		});
	}
	error(text: string, meta?: any, id?: string): void {
		this.#ready.then(() => {
			this.#logger!.error(text, meta, id);
		});
	}
	debug(text: string, meta?: any, id?: string): void {
		this.#ready.then(() => {
			this.#logger!.debug(text, meta, id);
		});
	}
}
