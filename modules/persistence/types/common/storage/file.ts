export /*bundle*/ interface IFileStorage {
	get root(): string;
	get path(): string;

	/**
	 * Returns a writable stream to write file contents to the given path.
	 */
	stream(): Promise<NodeJS.WritableStream>;

	/**
	 * Loads and returns the full content of the file as a buffer.
	 */
	load(): Promise<Buffer>;

	/**
	 * Checks whether the file exists at the given path.
	 */
	exists(): Promise<boolean>;

	/**
	 * Deletes the file at the given path.
	 */
	delete(): Promise<void>;
}
