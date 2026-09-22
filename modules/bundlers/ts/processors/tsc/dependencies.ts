import type { ConditionalProcessor } from '@beyond-js/packages/sdk';
import type { BaseConditional } from '@beyond-js/packages/module';
import * as ts from 'typescript';

/**
 * The declarations of the public modules of the workspace that the sources of a module import.
 *
 * They are read from the `types` conditional of each imported module, which is awaited for a bounded
 * time: two modules whose types depend on each other cannot both be first, so a dependency that does not
 * become ready in time is reported as unresolved instead of blocking the build. Each dependency is
 * subscribed to, and a change of its declaration reprocesses the processor that reads it; subscriptions
 * of dependencies a later build no longer imports are released.
 */
export class Dependencies {
	static WAIT = 8000;

	#processor: ConditionalProcessor;
	#subscriptions: Map<BaseConditional, () => void> = new Map();

	constructor(processor: ConditionalProcessor) {
		this.#processor = processor;
	}

	/**
	 * The bare specifiers the given sources import
	 */
	static specifiers(sources: string[]): Set<string> {
		const specifiers = new Set<string>();
		sources.forEach(content => {
			ts.preProcessFile(content, true, true).importedFiles.forEach(({ fileName }) => {
				!fileName.startsWith('.') && !fileName.startsWith('/') && specifiers.add(fileName);
			});
		});
		return specifiers;
	}

	/**
	 * Whether a bare specifier names a public module of the workspace
	 */
	published(specifier: string): boolean {
		return !!this.#processor.conditional.module.package.workspace?.resolve?.(specifier);
	}

	/**
	 * Reads the declaration of every imported public module of the workspace, and of every workspace module
	 * those declarations import in turn: a class a module extends may be declared two modules away, and the
	 * program resolves it only when that declaration is in it too.
	 *
	 * @returns The declarations by specifier, and the specifiers that could not be read
	 */
	async read(specifiers: Set<string>): Promise<{ declarations: Map<string, string>; unresolved: Map<string, string> }> {
		const declarations = new Map<string, string>();
		const unresolved = new Map<string, string>();
		const wanted = new Set<BaseConditional>();
		const visited = new Set<string>();
		const queue = [...specifiers].sort();

		while (queue.length) {
			const specifier = queue.shift();
			if (visited.has(specifier)) continue;
			visited.add(specifier);

			const outcome = await this.#read(specifier, wanted);
			if (!outcome) continue;
			if ('reason' in outcome) {
				unresolved.set(specifier, outcome.reason);
				continue;
			}
			declarations.set(specifier, outcome.code);
			Dependencies.specifiers([outcome.code]).forEach(imported => !visited.has(imported) && queue.push(imported));
		}

		[...this.#subscriptions.keys()].forEach(types => !wanted.has(types) && this.#unsubscribe(types));
		return { declarations, unresolved };
	}

	/**
	 * The declaration of one workspace module, or why it cannot be read; undefined for a specifier that
	 * is not a workspace module, or the module being checked itself
	 */
	async #read(specifier: string, wanted: Set<BaseConditional>): Promise<{ code: string } | { reason: string } | undefined> {
		const { module } = this.#processor.conditional;
		const resolution = module.package.workspace?.resolve?.(specifier);
		if (!resolution) return;

		const { package: pkg, subpath } = resolution;
		await pkg.ready;
		await pkg.modules.ready;
		const dependency = pkg.modules.get(subpath);
		if (!dependency) return { reason: `"${pkg.name}" declares no public module "${subpath}"` };
		if (dependency === module) return;

		await dependency.conditionals.ready;
		const types = dependency.conditionals.get('types');
		if (!types) return { reason: `"${specifier}" produces no declaration: its bundler has no types conditional` };

		wanted.add(types);
		this.#subscribe(types);

		const timeout = new Promise<'timeout'>(resolve => setTimeout(() => resolve('timeout'), Dependencies.WAIT));
		const outcome = await Promise.race([types.ready.then(() => 'ready'), timeout]);
		if (outcome === 'timeout') return { reason: `the declaration of "${specifier}" did not become ready: its types may depend on this module` };

		const code = types.output?.code();
		if (typeof code !== 'string') {
			return { reason: `"${specifier}" has no declaration: ${types.errors.map(({ message }) => message).join('; ') || 'its types conditional produced nothing'}` };
		}
		return { code };
	}

	#subscribe(types: BaseConditional) {
		if (this.#subscriptions.has(types)) return;
		const listener = () => this.#processor._invalidate();
		types.on('change', listener);
		this.#subscriptions.set(types, listener);
	}

	#unsubscribe(types: BaseConditional) {
		const listener = this.#subscriptions.get(types);
		listener && types.off('change', listener);
		this.#subscriptions.delete(types);
	}

	destroy() {
		[...this.#subscriptions.keys()].forEach(types => this.#unsubscribe(types));
	}
}
