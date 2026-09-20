import type { IDiagnostic } from '@beyond-js/packages/types';
import { Exports } from '@beyond-js/packages/publication';
import { existsSync, realpathSync, statSync } from 'fs';
import { extname, join } from 'path';
import type { IAnalysisConditions } from '../types';
import { Opened, type IPublicModule } from './opened';
import { Interop } from './interop';
import { Specifier } from '../specifier';

/**
 * An ordinary npm package.
 *
 * Every public subpath its manifest resolves for the requested conditions is one public module, compiled
 * on its own with `process.env.NODE_ENV` replaced (the requested environment, `production` when none is
 * requested). Its bare imports and requires stay public references, so a renderer and the library it peers
 * on share one module instead of each carrying a copy.
 */
export /*bundle*/ class NpmPackage extends Opened {
	#exports: Exports;

	get #published(): Exports {
		return (this.#exports = this.#exports ?? new Exports(this.manifest));
	}

	/**
	 * The resolution conditions and the `process.env.NODE_ENV` value every module of an ordinary npm package
	 * is compiled with
	 */
	static settings(conditions: IAnalysisConditions): { conditions: string[]; mode: string } {
		const { platform, environment } = conditions;
		return { conditions: Exports.conditions(platform, environment), mode: environment ?? 'production' };
	}

	#file(target: string): string | undefined {
		const base = join(this.root, target);
		const candidates = [base, `${base}.js`, `${base}.mjs`, `${base}.cjs`, join(base, 'index.js')];
		const found = candidates.find(candidate => existsSync(candidate) && statSync(candidate).isFile());
		return found && realpathSync(found);
	}

	async module(subpath: string, conditions: IAnalysisConditions) {
		const { platform, environment } = conditions;
		const resolved = this.#published.resolve(subpath, platform, environment);
		if (!resolved.target) return { diagnostics: resolved.diagnostics };

		const label = Specifier.of(this.name, subpath);
		const entry = this.#file(resolved.target);
		if (!entry) {
			const message = `"${label}" resolves to "${resolved.target}", which does not exist in package "${this.key}"`;
			return { diagnostics: <IDiagnostic[]>[{ code: 'EXPORT_TARGET_MISSING', message }] };
		}

		const supported = ['.js', '.mjs', '.cjs', '.json', '.css', '.ts', '.tsx', '.jsx', '.mts', '.cts'];
		if (!supported.includes(extname(entry))) {
			const message = `"${label}" resolves to "${resolved.target}", which is not code or a stylesheet. Declare static files as assets instead`;
			return { diagnostics: <IDiagnostic[]>[{ code: 'EXPORT_TARGET_UNSUPPORTED', message }] };
		}

		const style = extname(entry) === '.css';
		const directory = realpathSync(this.root);
		const module: IPublicModule = Object.assign({
			subpath,
			kind: style ? <const>'style' : <const>'module',
			entry,
			directory,
			facade: style ? void 0 : await new Interop(entry, this.manifest.type, resolved.via).facade(directory),
			assets: [],
			dynamic: []
		}, NpmPackage.settings(conditions));
		return { module, diagnostics: <IDiagnostic[]>[] };
	}

	async entries(conditions: IAnalysisConditions, except: string): Promise<Map<string, string>> {
		const entries: Map<string, string> = new Map();
		const own = this.#published.resolve(except, conditions.platform, conditions.environment).target;

		this.#published.subpaths.forEach(subpath => {
			const { target } = this.#published.resolve(subpath, conditions.platform, conditions.environment);
			const file = target && target !== own && !target.endsWith('.json') && this.#file(target);
			subpath !== except && file && !entries.has(file) && entries.set(file, Specifier.of(this.name, subpath));
		});
		return entries;
	}
}
