export /*bundle*/ interface IFileStorage {
	stream(path: string): Promise<NodeJS.WritableStream>;
	load(path: string): Promise<Buffer>;
	exists(path: string): Promise<boolean>;
	delete(path: string): Promise<void>;
}
