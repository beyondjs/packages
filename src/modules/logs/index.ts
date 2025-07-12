import { Logger as CDNLogger } from '@beyond-js/logs/main';

type Environment = 'cdn' | 'ci' | 'local';

export /*buncle*/ class Logger {
	#id: string;
	#env: Environment;

	constructor(id: string, env: Environment) {
		this.#id = id;
		this.#env = env;
	}

	async initialize() {}

	async add(message: string, level: 'info' | 'warn' | 'error' = 'info') {
		if (this.#env === 'local') {
			console[level](message);
			return;
		}

		const logger = new CDNLogger('beyond-logs');
		switch (level) {
			case 'info':
				logger.info(message);
				break;
			case 'warn':
				logger.warn(message);
				break;
			case 'error':
				logger.error(message);
				break;
		}
	}
}
