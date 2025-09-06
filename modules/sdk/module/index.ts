import type { IDiagnostic } from '@beyond-js/packages/types';
import { BaseModule as PackageBaseModule } from '@beyond-js/packages/module';

export /*bundle*/ interface IProcessorSpec {
	specifier: string;
	[key: string]: any;
}

export /*bundle*/ interface IProcessors {
	processors: Map<string, IProcessorSpec>;
	errors: IDiagnostic[];
	warnings: IDiagnostic[];
}

export /*bundle*/ abstract class BaseModule extends PackageBaseModule {
	/**
	 * The processors are specific of the conditional, but they can be the same for all conditionals of the module,
	 * so the conditional calls this method to get the processors if not overridden by the conditional.
	 */
	_processors(): IProcessors {
		throw new Error('Method must be implemented by the derived class or by the conditional.');
	}
}
