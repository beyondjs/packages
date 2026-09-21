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
	 * Reads the declaration of every imported public module of the workspace
	 *
	 * @returns The declarations by specifier, and the specifiers that could not be read
	 */
	async read(specifiers: Set<string>): Promise<{ declarations: Map<string, string>; unresolved: Map<string, string> }> {
		const declarations = new Map<string, string>();
		const unresolved = new Map<string, string>();
		const wanted = new Set<BaseConditional>();
		const { module } = this.#processor.conditional;
		const workspace = module.package.workspace;

		for (const specifier of [...specifiers].sort()) {
			const resolution = workspace?.resolve?.(specifier);
			if (!resolution) continue;

			const { package: pkg, subpath } = resolution;
			await pkg.ready;
			await pkg.modules.ready;
			const dependency = pkg.modules.get(subpath);
			if (!dependency) {
				unresolved.set(specifier, `"${pkg.name}" declares no public module "${subpath}"`);
				continue;
			}
			if (dependency === module) continue;

			await dependency.conditionals.ready;
			const types = dependency.conditionals.get('types');
			if (!types) {
				unresolved.set(specifier, `"${specifier}" produces no declaration: its bundler has no types conditional`);
				continue;
			}

			wanted.add(types);
			this.#subscribe(types);

			const timeout = new Promise<'timeout'>(resolve => setTimeout(() => resolve('timeout'), Dependencies.WAIT));
			const outcome = await Promise.race([types.ready.then(() => 'ready'), timeout]);
			if (outcome === 'timeout') {
				unresolved.set(specifier, `the declaration of "${specifier}" did not become ready: its types may depend on this module`);
				continue;
			}

			const code = types.output?.code();
			if (typeof code !== 'string') {
				unresolved.set(specifier, `"${specifier}" has no declaration: ${types.errors.map(({ message }) => message).join('; ') || 'its types conditional produced nothing'}`);
				continue;
			}
			declarations.set(specifier, code);
		}

		[...this.#subscriptions.keys()].forEach(types => !wanted.has(types) && this.#unsubscribe(types));
		return { declarations, unresolved };
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
