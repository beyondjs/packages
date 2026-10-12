import type { IBuildable, IPublishedModule } from '../builds';
import type { Preview } from '../preview';
import type { Selection } from '../selection';
import { DevelopmentError } from '../error';
import { Redaction } from '../preview/redaction';
import type { IApplicationsCatalog, ICatalogTarget, IResolvedTarget } from './types';
import { Bound } from './bound';
import { Diagnostics } from './diagnostics';
import { Summary } from './summary';

const PLATFORMS = { web: { platform: 'web', environment: 'development' }, node: { platform: 'node', environment: 'development' } };

/**
 * What the Core establishes for a declared target (`GET /applications/:application/targets/:target`): the entry module
 * found among the public modules the workspace serves (`TARGET_PACKAGE_NOT_FOUND`, `TARGET_ENTRY_NOT_FOUND`,
 * `TARGET_AMBIGUOUS` otherwise), whether it builds for its environment (`TARGET_ENVIRONMENT_UNSUPPORTED` when its module
 * has no output for that platform), the composition of its graph by source, and how it starts: the preview document of
 * a frontend target (`open.preview`, a path the client joins with the preview origin of the session), and whether a
 * backend one can be launched (`launch`, with the specifier a launch imports). Resolution reads: it builds only what
 * the routes of the service build on request, waits for those builds within a bound (`Bound`) and never starts a
 * process.
 *
 * A consumer requests the entry by its public specifier, or by its versioned one when several local versions publish
 * it, as the session, the preview and the documents of the service name it: that is `launch.specifier`, and the
 * address `open.preview` names.
 */
export class Resolution {
	#delivery: IBuildable;
	#selection: Selection;
	#summary: Summary;
	#bound: Bound;

	constructor(delivery: IBuildable, preview: Preview, selection: Selection, environment: NodeJS.ProcessEnv = process.env) {
		this.#delivery = delivery;
		this.#selection = selection;
		this.#summary = new Summary(preview);
		this.#bound = new Bound(environment);
	}

	static #specifier({ specifier, name, subpath }: IPublishedModule): string {
		return specifier ?? (subpath === '.' ? name : `${name}/${subpath.replace(/^\.\//, '')}`);
	}

	/**
	 * @throws DevelopmentError `APPLICATION_NOT_FOUND` or `TARGET_NOT_FOUND` (404)
	 */
	async resolve(catalog: IApplicationsCatalog, id: string, name: string): Promise<IResolvedTarget> {
		const application = catalog.applications.find(one => one.id === id);
		if (!application) {
			const details = catalog.diagnostics.length ? { diagnostics: catalog.diagnostics } : {};
			throw new DevelopmentError('APPLICATION_NOT_FOUND', `The workspace declares no application "${id}"`, 404, details);
		}
		const declared = application.targets.find(one => one.id === name);
		if (!declared) throw new DevelopmentError('TARGET_NOT_FOUND', `The application "${id}" declares no target "${name}"`, 404);

		const diagnostics = new Diagnostics();
		const published = declared.specifier ? await this.#published() : [];
		const module = declared.specifier ? this.#entry(declared, published, diagnostics) : void 0;
		const platform = declared.environment === 'browser' ? 'web' : 'node';

		let entry: IResolvedTarget['entry'] = declared.specifier ? { specifier: declared.specifier } : {};
		let build: IResolvedTarget['build'];
		if (module) {
			const selection = await this.#selection.read();
			const source = module.supplied ? 'toolchain' : 'workspace';
			const pkg = { name: module.name, version: module.version, source: <'toolchain' | 'workspace'>source, selected: this.#selection.covers(selection, module) };
			entry = { specifier: Resolution.#specifier(module), vspecifier: module.vspecifier, package: pkg };
			declared.environment && (build = await this.#build(module, platform, declared, diagnostics));
		}

		// Several local versions of the package are named by the versioned specifier, as the preview names them
		const shared = module && published.filter(one => Resolution.#specifier(one) === Resolution.#specifier(module)).length > 1;
		const requested = module && (shared ? module.vspecifier : Resolution.#specifier(module));
		const frontend = declared.kind === 'frontend' && module;
		const reached = module && build?.state !== 'unsupported';
		// The composition builds the graph of the entry: not while its build is still pending
		const composition = reached && build?.state !== 'pending' && (await this.#composition(requested, module, frontend ? 'web' : 'node'));

		return {
			protocol: catalog.protocol,
			generation: catalog.generation,
			application: { id, ...(application.title !== undefined ? { title: application.title } : {}) },
			declared,
			entry,
			...(declared.environment ? { environment: declared.environment } : {}),
			...(build ? { build } : {}),
			...(composition ? { composition } : {}),
			...(frontend && reached ? { open: { preview: `/preview/?entry=${encodeURIComponent(requested)}` } } : {}),
			...(declared.kind === 'backend' ? { launch: Resolution.#launch(declared, diagnostics, requested) } : {}),
			diagnostics: diagnostics.list
		};
	}

	async #published(): Promise<IPublishedModule[]> {
		await this.#delivery.refresh?.();
		return this.#delivery.published();
	}

	/**
	 * The public module of the workspace that is the target's entry. A package named with its provider (`npm:name`) is
	 * found by its name. When several local versions publish it, the target's `selection` names one of them by its exact
	 * version, or the entry is ambiguous.
	 */
	#entry(declared: ICatalogTarget, published: IPublishedModule[], diagnostics: Diagnostics): IPublishedModule | undefined {
		const name = declared.package.replace(/^[a-z][a-z0-9-]*:/, '');
		const own = published.filter(module => module.name === name);
		if (!own.length) {
			diagnostics.error('TARGET_PACKAGE_NOT_FOUND', `The workspace has no package "${name}"`, 'package');
			return;
		}
		const found = own.filter(module => Resolution.#specifier(module) === declared.specifier);
		if (!found.length) {
			diagnostics.error('TARGET_ENTRY_NOT_FOUND', `"${name}" publishes no public module "${declared.entry}" (its exports name its public modules)`, 'entry');
			return;
		}
		if (found.length === 1) return found[0];

		const selected = found.filter(module => module.version === declared.selection);
		if (selected.length === 1) return selected[0];
		const candidates = found.map(({ vspecifier }) => vspecifier).join(', ');
		const message = `Several local versions publish "${declared.specifier}" (${candidates}): the target's selection names one of them by its exact version`;
		diagnostics.error('TARGET_AMBIGUOUS', message, 'selection');
	}

	/**
	 * Whether the entry builds for the platform of its environment: its output, or that its module does not declare
	 * that platform, or why it does not build now, or that it is still being built once the bound passed
	 */
	async #build(module: IPublishedModule, platform: 'web' | 'node', declared: ICatalogTarget, diagnostics: Diagnostics): Promise<IResolvedTarget['build']> {
		const raced = await this.#bound.race(this.#delivery.module(module, PLATFORMS[platform]));
		if (raced.expired) {
			const message = `"${declared.specifier}" is still being built for ${platform} after ${this.#bound.milliseconds} ms (${Bound.VARIABLE}): read the target again to know whether it builds`;
			diagnostics.warning('TARGET_BUILD_PENDING', message);
			return { platform, state: 'pending' };
		}
		const { delivered, failure } = raced.value;
		if (delivered) return { platform, state: 'built', hash: delivered.hash };

		const reasons = failure.diagnostics ?? [failure];
		if (reasons.every(({ code }) => code === 'CONDITIONAL_NOT_FOUND')) {
			const message = `"${declared.specifier}" has no output for ${declared.environment === 'browser' ? 'a browser' : declared.environment}: its module does not declare the ${platform} platform`;
			diagnostics.error('TARGET_ENVIRONMENT_UNSUPPORTED', message, 'kind');
			return { platform, state: 'unsupported' };
		}
		const message = reasons.map(({ message }) => Redaction.text(message)).join('; ');
		diagnostics.warning('TARGET_BUILD_FAILED', `"${declared.specifier}" does not build for ${platform} now: ${message}`);
		return { platform, state: 'failed' };
	}

	/**
	 * The composition of the entry's graph within the bound: past it, its summary says the composition was not
	 * described yet
	 */
	async #composition(requested: string, module: IPublishedModule, platform: 'web' | 'node') {
		const raced = await this.#bound.race(this.#summary.read(requested, module, platform));
		if (!raced.expired) return raced.value;
		return { packages: {}, modules: {}, reason: `The composition of "${requested}" was not described within ${this.#bound.milliseconds} ms (${Bound.VARIABLE})` };
	}

	/**
	 * Whether the Core can launch a backend target: a valid declaration, a resolved entry with an output for its
	 * environment, and a runtime it launches (Node, or Deno where Deno is configured), with the specifier a launch imports
	 */
	static #launch(declared: ICatalogTarget, diagnostics: Diagnostics, specifier?: string): IResolvedTarget['launch'] {
		const errors = [...declared.diagnostics, ...diagnostics.list].filter(({ severity }) => severity === 'error');
		if (errors.length) return { supported: false, reason: errors[0].code };
		if (declared.environment === 'node') return { supported: true, specifier };
		if (declared.environment === 'deno') return { supported: true, requires: 'deno', specifier };
		return { supported: false, reason: 'TARGET_RUNTIME_UNSUPPORTED' };
	}
}
