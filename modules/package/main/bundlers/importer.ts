import type { IDiagnostic, BundlerSettingsType } from '@beyond-js/packages/types';
import type { BaseModule } from '@beyond-js/packages/module';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import { join } from 'path';

const DEV = true;

interface IResponse {
	errors?: IDiagnostic[];
	Module?: typeof BaseModule;
	path?: string;
}

declare const bimport: (specifier: string) => Promise<any>;

const done = ({ errors, Module, path, specifier }: IResponse & { specifier: string }): IResponse => {
	if (!errors?.length && typeof Module !== 'function') {
		const code = 'BUNDLER_MODULE_NOT_FOUND';
		const message = `Bundler "${specifier}" does not export a valid 'Module' class`;
		return { errors: [{ code, message }] };
	}

	return { errors, Module, path };
};

async function dev(specifier: string, path: string): Promise<IResponse> {
	void path; // eslint-disable-line no-unused-vars
	try {
		const mod = await bimport(specifier);
		const { Module } = mod;
		return done({ Module, specifier });
	} catch (exc) {
		const code = 'BUNDLER_IMPORT_ERROR';
		const message = `Error importing bundler "${specifier}": ${exc.message}`;
		return done({ errors: [{ code, message }], specifier });
	}
}

async function prod(specifier: string, basedir: string): Promise<IResponse> {
	let path: string = null;
	try {
		const require = createRequire(join(basedir, '.__resolver__.js'));
		path = require.resolve(specifier);
	} catch (exc) {
		const code = 'BUNDLER_NOT_FOUND';
		const message = `Bundler "${specifier}" not found`;
		console.log(code, message);
		return done({ errors: [{ code, message }], specifier });
	}

	try {
		const mod = await bimport(pathToFileURL(path).href);
		const { Module } = mod;
		return done({ Module, path, specifier });
	} catch (exc) {
		const code = 'BUNDLER_IMPORT_ERROR';
		const message = `Error requiring bundler "${specifier}": ${exc.message}`;
		return done({ errors: [{ code, message }], specifier });
	}
}

export const importer = DEV ? dev : prod;
