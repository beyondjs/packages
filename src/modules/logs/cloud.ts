import { Logging } from '@google-cloud/logging';
import { ILogger } from './types';

const logging = new Logging();
const log = logging.log('application');

export class GCPLogger implements ILogger {
	private write(severity: string, message: string, meta?: any) {
		const entry = log.entry(
			{ severity },
			{
				message,
				...(meta ? { meta } : {})
			}
		);
		log.write(entry).catch(console.error);
	}

	info(message: string, meta?: any) {
		this.write('INFO', message, meta);
	}

	warn(message: string, meta?: any) {
		this.write('WARNING', message, meta);
	}

	error(message: string, meta?: any) {
		this.write('ERROR', message, meta);
	}

	debug(message: string, meta?: any) {
		this.write('DEBUG', message, meta);
	}
}
