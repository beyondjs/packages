import type { ProcessorSettings } from './settings';
import type { ProcessorSpec } from './spec';
import type { ProcessorSources } from './sources';
import type { ProcessorSourcesInputs } from './sources/inputs';
import type { DynamicFile } from '@beyond-js/file/dynamic';
import type { ProcessorDelegator } from './delegator';
import type { Preprocessor } from './delegator/preprocessor';
import type { ProcessorOutputs } from './outputs';
import type { ImsOutput } from './outputs/ims';
import type { CssOutput } from './outputs/css';
import type { TypesOutput } from './outputs/types';
import type { ProcessorSourcesHash } from './sources/hash';

export /*bundle*/ interface IProcessorStrategy {
	// If Spec is not specified, then the ProcessorSettings will be used as default
	Spec?: typeof ProcessorSpec;
	// If Settings is not specified, then the ProcessorSettings will be used as default
	Settings?: typeof ProcessorSettings;
	sources: IProcessorSourcesStrategy;
	delegator?: IProcessorDelegatorStrategy;
	outputs: IProcessorOutputsStrategy;
}

export /*bundle*/ interface IProcessorSourcesStrategy {
	Sources: typeof ProcessorSources;
	inputs: IProcessorInputsStrategy;
	files: IProcessorSourcesFileStrategy[];
	Hash: typeof ProcessorSourcesHash;
}

export /*bundle*/ interface IProcessorInputsStrategy {
	Inputs: typeof ProcessorSourcesInputs;
	extname: string[] | string;
}

export /*bundle*/ interface IProcessorSourcesFileStrategy {
	File?: typeof DynamicFile;
	// When true, File uses DynamicFileObject instead of DynamicFile
	// Discarded when File is specified
	json?: boolean;
	file: string;
}

type PreprocessorCtor<T extends Preprocessor = Preprocessor> = new (
	...args: ConstructorParameters<typeof Preprocessor>
) => T;

export /*bundle*/ interface IProcessorDelegatorStrategy {
	// If Delegator is not specified, then the ProcessorDelegator will be used as default
	Delegator?: typeof ProcessorDelegator;
	Preprocessor: PreprocessorCtor;
	delegates: string[];
}

export /*bundle*/ interface IProcessorOutputsStrategy {
	Outputs: typeof ProcessorOutputs;
	InternalModules?: typeof ImsOutput;
	Css?: typeof CssOutput;
	Types?: typeof TypesOutput;
}
