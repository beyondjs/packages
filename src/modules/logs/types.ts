export interface Logger {
	info(text: string, meta?: any, id?: string): Promise<void>;
	warn(text: string, meta?: any, id?: string): Promise<void>;
	error(text: string, meta?: any, id?: string): Promise<void>;
	debug(text: string, meta?: any, id?: string): Promise<void>;
}
