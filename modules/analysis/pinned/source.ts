import type { IDiagnostic } from '@beyond-js/packages/types';
import { Package } from '@beyond-js/packages/package';
import { existsSync, realpathSync } from 'fs';
import { join, posix } from 'path';
import type { IAnalysisConditions } from '../types';
import { Opened, type IPublicModule } from './opened';
import { Specifier } from '../specifier';

/**
 * A package published as Beyond sources.
 *
 * Its public modules are the ones its `exports` entries and module manifests declare, read with the same
 * declarations a workspace package is read with. A module manifest adds `platforms`, the `assets` the
 * module declares (paths relative to the module directory) and `dynamic`, the public modules its
 * indeterminate dynamic imports may load. The bundlers the package names are not imported: a published
 * package is compiled by the compiler its consumer selects.
 */
export /*bundle*/ class SourcePackage extends Opened {
	#pkg: Package;

	async #specs() {
		this.#pkg = this.#pkg ?? new Package(this.root);
		await this.#pkg.ready;
		await this.#pkg.modules.ready;
		return this.#pkg.modules;
	}

	async module(subpath: string, conditions: IAnalysisConditions) {
		const diagnostics: IDiagnostic[] = [];
		const fail = (code: string, message: string) => (diagnostics.push({ code, message }), { diagnostics });

		const modules = await this.#specs();
		const spec = modules.specs.get(subpath);
		const label = Specifier.of(this.name, subpath);
		if (!spec) {
			const reasons = this.#pkg.errors.concat(modules.errors).map(({ message }) => message);
			return fail('MODULE_NOT_FOUND', `Package "${this.key}" does not publish "${label}"${reasons.length ? `: ${reasons.join('; ')}` : ''}`);
		}

		const values = <Record<string, any>>spec.values;
		if (!spec.entry) return fail('MODULE_ENTRY_MISSING', `Module "${label}" does not define its entry point`);

		const platforms: string[] = [].concat(values.platforms ?? []).map(platform => (platform === 'web' ? 'browser' : platform));
		if (platforms.length && !platforms.includes(conditions.platform) && !platforms.includes('default')) {
			return fail('PLATFORM_UNSUPPORTED', `Module "${label}" is declared for ${platforms.join(', ')}, not for "${conditions.platform}"`);
		}

		const directory = join(this.root, spec.path ?? '');
		const entry = join(directory, spec.entry);
		if (!existsSync(entry)) return fail('MODULE_ENTRY_MISSING', `The entry point of "${label}" does not exist: ${posix.join(spec.path ?? '', spec.entry)}`);

		const list = (value: unknown): string[] => (value instanceof Array ? value.filter(one => typeof one === 'string') : []);
		const module: IPublicModule = {
			subpath,
			kind: values.kind === 'style' ? 'style' : 'module',
			entry: realpathSync(entry),
			directory: realpathSync(directory),
			assets: list(values.assets).map(path => posix.normalize(posix.join(spec.path ?? '', path))),
			dynamic: list(values.dynamic)
		};
		return { module, diagnostics };
	}

	async entries(conditions: IAnalysisConditions, except: string): Promise<Map<string, string>> {
		void conditions;
		const entries: Map<string, string> = new Map();
		(await this.#specs()).specs.forEach((spec, subpath) => {
			const file = spec.entry && join(this.root, spec.path ?? '', spec.entry);
			subpath !== except && file && existsSync(file) && entries.set(realpathSync(file), Specifier.of(this.name, subpath));
		});
		return entries;
	}

	destroy(): void {
		this.#pkg?.destroy();
	}
}
