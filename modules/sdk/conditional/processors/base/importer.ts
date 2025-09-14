import type { IDiagnostic } from '@beyond-js/packages/types';
import type { ProcessorConstructor } from './types';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import { join } from 'path';

const DEV = true;

interface IResponse {
	errors?: IDiagnostic[];
	Processor?: ProcessorConstructor;
	path?: string;
}

declare const bimport: (specifier: string) => Promise<any>;

const done = ({ errors, Processor, path, specifier }: IResponse & { specifier: string }): IResponse => {
	if (!errors?.length && typeof Processor !== 'function') {
		const code = 'PROCESSOR_NOT_FOUND';
		const message = `Processor "${specifier}" does not export a valid 'Processor' class`;
		return { errors: [{ code, message }] };
	}

	return { errors, Processor, path };
};

async function dev(specifier: string, basedir: string): Promise<IResponse> {
	void basedir; // eslint-disable-line no-unused-vars
	try {
		const mod = await bimport(specifier);
		const { Processor } = mod;
		return done({ Processor, specifier });
	} catch (exc) {
		const code = 'PROCESSOR_IMPORT_ERROR';
		const message = `Error importing processor "${specifier}": ${exc.message}`;
		return done({ errors: [{ code, message }], specifier });
	}
}

async function prod(specifier: string, basedir: string): Promise<IResponse> {
	let path: string = null;
	try {
		const require = createRequire(join(basedir, '.__resolver__.js'));
		path = require.resolve(specifier);
	} catch (exc) {
		const code = 'PROCESSOR_NOT_FOUND';
		const message = `Processor "${specifier}" not found`;
		console.log(code, message);
		return done({ errors: [{ code, message }], specifier });
	}

	try {
		const mod = await bimport(pathToFileURL(path).href);
		const { Processor } = mod;
		return done({ Processor, path, specifier });
	} catch (exc) {
		const code = 'PROCESSOR_IMPORT_ERROR';
		const message = `Error requiring processor "${specifier}": ${exc.message}`;
		return done({ errors: [{ code, message }], specifier });
	}
}

export const importer = DEV ? dev : prod;
