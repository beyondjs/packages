import type { ConditionalProcessor } from '@beyond-js/packages/sdk';
import { basename, dirname, isAbsolute, relative, sep } from 'path';

/**
 * A listener of the watcher client of a package, on one file
 */
interface IListener {
	on(event: string, callback: (event: string, file: string) => void): void;
	off(event: string, callback: (event: string, file: string) => void): void;
	listen(): Promise<unknown>;
	destroy(): void;
}

/**
 * The files a build read besides the inputs of the processor: the partials a stylesheet imports, a theme
 * it includes, the sources whose class names a Tailwind stylesheet scans, a plugin or a configuration.
 *
 * They are discovered by compiling, so they cannot be declared in the strategy of the processor. After a
 * build, the processor declares what it read; each file of the package is then watched, and a change to
 * any of them invalidates the processor, which builds again and declares the files of that build. A file
 * that a later build no longer reads is released. Files outside the package are not watched: the watcher
 * of the package covers its directory, and a stylesheet of an installed package (Tailwind's own, a
 * plugin's) changes only when the installation does.
 */
export class Dependencies {
	#processor: ConditionalProcessor;
	#watching: Map<string, { listener: IListener; callback: (event: string, file: string) => void }> = new Map();

	/**
	 * The files read by the last build, as absolute paths
	 */
	#files: Set<string> = new Set();
	get files(): string[] {
		return [...this.#files].sort();
	}

	constructor(processor: ConditionalProcessor) {
		this.#processor = processor;
	}

	#inside(file: string): boolean {
		const { module } = this.#processor.conditional;
		const path = relative(module.package.path, file);
		return !!path && !path.startsWith('..') && !isAbsolute(path) && !path.split(sep).includes('node_modules');
	}

	/**
	 * Declares the files the last build read. Files that are inputs of the processor are already watched
	 * by it and are left out.
	 */
	async update(read: Iterable<string>): Promise<void> {
		const { module } = this.#processor.conditional;
		const inputs = new Set<string>();
		this.#processor.sources.inputs?.forEach(input => inputs.add(input.file));

		this.#files = new Set([...read].filter(file => !inputs.has(file)));
		const wanted = new Set([...this.#files].filter(file => this.#inside(file)));

		[...this.#watching.keys()].forEach(file => !wanted.has(file) && this.#release(file));

		const { watcher } = module.package;
		if (!watcher) return;

		const started: Promise<unknown>[] = [];
		for (const file of wanted) {
			if (this.#watching.has(file)) continue;

			const listener: IListener = watcher.listeners.create(dirname(file), { filename: basename(file) });
			const callback = (event: string, changed: string) => changed === file && this.#processor._invalidate();
			listener.on('all', callback);
			this.#watching.set(file, { listener, callback });
			started.push(listener.listen());
		}
		await Promise.all(started);
	}

	#release(file: string) {
		const watching = this.#watching.get(file);
		if (!watching) return;
		this.#watching.delete(file);
		watching.listener.off('all', watching.callback);
		watching.listener.destroy();
	}

	destroy() {
		[...this.#watching.keys()].forEach(file => this.#release(file));
	}
}
