import type { IDiagnostic } from '@beyond-js/packages/types';
import type { BaseModule } from '@beyond-js/packages/module';
import type { ModuleConstructor } from './bundler';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import { join } from 'path';

/**
 * Whether a bundler implementation is loaded as a public module being developed, or resolved as an
 * installed dependency of the package that registers it
 */
const DEV = true;

interface IResponse {
	errors?: IDiagnostic[];
	Module?: ModuleConstructor<BaseModule>;
	path?: string;
}

const done = ({ errors, Module, path, specifier }: IResponse & { specifier: string }): IResponse => {
	if (!errors?.length && typeof Module !== 'function') {
		const code = 'BUNDLER_MODULE_NOT_FOUND';
		const message = `Bundler "${specifier}" does not export a valid 'Module' class`;
		return { errors: [{ code, message }] };
	}

	return { errors, Module, path };
};

/**
 * Imports the bundler as a public module.
 *
 * The specifier is imported as it was registered, so the loader of the process decides where the
 * implementation comes from: a development server serving the compiled modules, or the installed package.
 * Resolution is therefore configuration of the running process, not of this importer.
 */
async function dev(specifier: string, basedir: string): Promise<IResponse> {
	void basedir; // eslint-disable-line no-unused-vars
	try {
		const mod = await import(specifier);
		const { Module } = mod;
		return done({ Module, specifier });
	} catch (exc) {
		const code = 'BUNDLER_IMPORT_ERROR';
		const message = `Error importing bundler "${specifier}": ${exc.message}`;
		return done({ errors: [{ code, message }], specifier });
	}
}

/**
 * Imports the bundler as an installed dependency of the package that registers it, resolving it from that
 * package directory so that each package can use its own version of a bundler
 */
async function prod(specifier: string, basedir: string): Promise<IResponse> {
	let path: string = null;
	try {
		const require = createRequire(join(basedir, '.__resolver__.js'));
		path = require.resolve(specifier);
	} catch (exc) {
		const code = 'BUNDLER_NOT_FOUND';
		const message = `Bundler "${specifier}" not found`;
		return done({ errors: [{ code, message }], specifier });
	}

	try {
		const mod = await import(pathToFileURL(path).href);
		const { Module } = mod;
		return done({ Module, path, specifier });
	} catch (exc) {
		const code = 'BUNDLER_IMPORT_ERROR';
		const message = `Error requiring bundler "${specifier}": ${exc.message}`;
		return done({ errors: [{ code, message }], specifier });
	}
}

export const importer = DEV ? dev : prod;
