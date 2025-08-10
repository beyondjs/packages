export /*bundle*/ interface IDiagnostic {
	code: string;
	message: string;
	stack?: string;
}

interface IModule {
	new (): () => void;
}

export /*bundle*/ interface IBundlerSpec {
	meta: IModule | { Module: IModule };
}
