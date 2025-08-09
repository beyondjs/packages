export /*bundle*/ interface IDiagnostic {
	code: string;
	message: string;
	stack?: string;
}

export /*bundle*/ interface IBundleSpec {
	id: string;
	subpath: string;
	description: string;
}

interface IModule {
	new (): () => void;
}

export /*bundle*/ interface IBundlerSpec {
	meta: IModule | { Module: IModule };
}
