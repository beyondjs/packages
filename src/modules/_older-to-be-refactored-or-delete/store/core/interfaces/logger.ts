export interface ILogger {
	add(message: string, severity?: 'INFO' | 'WARNING' | 'ERROR'): Promise<void>;
	get(): Promise<{ metadata: any; data: string }[]>;
	error?: string;
	close?(): void;
}
