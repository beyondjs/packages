import type { ProcessorSettings } from './settings';
import type { ProcessorSpec } from './spec';
import type { ProcessorSources } from './sources';
import type { ProcessorSourcesFile } from './sources/files/file';
import type { ProcessorExtender } from './extender';
import type { Preprocessor } from './extender/preprocessor';
import type { ProcessorOutputs } from './outputs';
import type { ImsOutputs } from './outputs/ims';
import type { CssOutputs } from './outputs/css';
import type { TypesOutputs } from './outputs/types';

export /*bundle*/ interface IProcessorStrategy {
	// If Spec is not specified, then the ProcessorSettings will be used as default
	Spec?: typeof ProcessorSpec;
	// If Settings is not specified, then the ProcessorSettings will be used as default
	Settings?: typeof ProcessorSettings;
	sources: IProcessorSourcesStrategy;
	extender?: IProcessorExtenderStrategy;
	outputs: IProcessorOutputsStrategy;
}

export /*bundle*/ interface IProcessorSourcesStrategy {
	Sources: typeof ProcessorSources;
	inputs: {
		Inputs: typeof ProcessorSources;
	};
	files: IProcessorSourcesFileStrategy[];
}

export /*bundle*/ interface IProcessorSourcesFileStrategy {
	File?: typeof ProcessorSourcesFile;
	file: string;
}

export /*bundle*/ interface IProcessorExtenderStrategy {
	// If Extender is not specified, then the ProcessorExtender will be used as default
	Extender?: typeof ProcessorExtender;
	Preprocessor: typeof Preprocessor;
	extends: string[];
}

export /*bundle*/ interface IProcessorOutputsStrategy {
	Outputs: typeof ProcessorOutputs;
	InternalModules?: typeof ImsOutputs;
	Css?: typeof CssOutputs;
	Types?: typeof TypesOutputs;
}
