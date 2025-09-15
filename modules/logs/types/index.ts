export /*bundle*/ interface ILoggerOptions {
	console?: boolean;
}

export /*bundle*/ interface ILogger {
	id: string;
	init: () => Promise<void>;
	info(text: string, meta?: any, id?: string): void;
	warn(text: string, meta?: any, id?: string): void;
	error(text: string, meta?: any, id?: string): void;
	debug(text: string, meta?: any, id?: string): void;
}
