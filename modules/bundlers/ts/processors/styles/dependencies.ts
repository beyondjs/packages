import type { ConditionalProcessor } from '@beyond-js/packages/sdk';
import { basename, dirname, isAbsolute, relative, sep } from 'path';

/**
 * A listener of the watcher client of a package, on one file
 */
interface IWatcher {
	listeners: { create(directory: string, options: { filename: string }): IListener };
}

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
 * that a later build no longer reads is released. A file of another package of the workspace, such as
 * the theme of a shared package that a module's SCSS includes, is watched through the watcher of that
 * package, so a change to it rebuilds every module of the workspace that reads it. A file of an installed
 * package (Tailwind's own, a plugin's) is not watched: it changes only when the installation does.
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

	/**
	 * Whether a file is a source of a package: inside its directory and not installed there
	 */
	static #inside(pkg: { path: string }, file: string): boolean {
		const path = relative(pkg.path, file);
		return !!path && !path.startsWith('..') && !isAbsolute(path) && !path.split(sep).includes('node_modules');
	}

	/**
	 * The watched package of the workspace that owns a file: the package of the module, or another package
	 * of the workspace; undefined for a file of an installed package or of a package that is not watched
	 */
	#owner(file: string): { watcher?: IWatcher } | undefined {
		const { module } = this.#processor.conditional;
		const own = module.package;
		if (Dependencies.#inside(own, file)) return own;

		const packages = [...(module.package.workspace?.packages?.values() ?? [])];
		const found = packages.find(pkg => pkg !== own && pkg.watcher && Dependencies.#inside(pkg, file));
		return found;
	}

	/**
	 * Declares the files the last build read. Files that are inputs of the processor are already watched
	 * by it and are left out.
	 */
	async update(read: Iterable<string>): Promise<void> {
		const inputs = new Set<string>();
		this.#processor.sources.inputs?.forEach(input => inputs.add(input.file));

		this.#files = new Set([...read].filter(file => !inputs.has(file)));
		const owners = new Map<string, IWatcher>();
		this.#files.forEach(file => {
			const watcher = this.#owner(file)?.watcher;
			watcher && owners.set(file, watcher);
		});
		const wanted = new Set(owners.keys());

		[...this.#watching.keys()].forEach(file => !wanted.has(file) && this.#release(file));

		const started: Promise<unknown>[] = [];
		for (const file of wanted) {
			if (this.#watching.has(file)) continue;

			const listener: IListener = owners.get(file).listeners.create(dirname(file), { filename: basename(file) });
			const callback = (event: string, changed: string) => changed === file && this.#processor._invalidate();
			listener.on('all', callback);
			this.#watching.set(file, { listener, callback });
			/**
			 * A listener that cannot start is released, and the build goes on unwatched for that file: the
			 * watcher of a package is destroyed when the workspace reloads after a manifest change, and a
			 * listener asked of it in that window is refused by the watchers service. The processor of the
			 * reloaded workspace declares its own dependencies again.
			 */
			started.push(listener.listen().catch(() => this.#release(file)));
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
