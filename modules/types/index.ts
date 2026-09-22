export /*bundle*/ interface IDiagnostic {
	code: string;
	message: string;
	stack?: string;

	/**
	 * The absolute path of the source file the diagnostic is about, when the producer knows it. It is an
	 * internal identity: what leaves the service names the file relative to what the consumer sees, or not
	 * at all. The message keeps the file and the position as text for consumers that read only the message.
	 */
	file?: string;

	/**
	 * The one-based line and column in `file`
	 */
	position?: { line: number; column: number };
}

interface IModule {
	new (): () => void;
}

export /*bundle*/ interface IBundlerSpec {
	meta: IModule | { Module: IModule };
}
