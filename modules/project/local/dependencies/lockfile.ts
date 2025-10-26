// modules/project/local/dependencies/lockfile.ts
import type { DependenciesGraph, Node } from '@beyond-js/packages/dependencies/graph';
import type { Package } from '@beyond-js/packages/package';
import { PendingPromise } from '@beyond-js/pending-promise/main';
import * as fs from 'fs';
import { join } from 'path';

const { readFile, writeFile } = fs.promises;

/**
 * Defines the specification for a dependency as recorded in the lock file.
 */
interface ILockDependencySpec {
	name: string;
	version: { specified: string; resolved: string };
}

/**
 * Defines the structure for a single resolved package entry in the lock file.
 */
interface ILockEntry extends ILockDependencySpec {
	kind: string;
	dependencies?: Record<string, ILockDependencySpec>;
}

/**
 * Defines the structure of the entire lock file.
 * Keys are typically 'package-name@resolved-version'.
 */
export interface ILockFile {
	[key: string]: ILockEntry; // Changed key name
}

/**
 * Manages the beyond.lock file, loading it on initialization.
 */
export class LockFile {
	readonly #pkg: Package;
	readonly #file: string;

	#loaded = false;
	get loaded(): boolean {
		return this.#loaded;
	}

	#loading: PendingPromise<void>;

	#data: ILockFile | null = null;
	get data(): ILockFile | null {
		if (!this.#loaded) {
			throw new Error(
				'Lock file data is not yet loaded. Please await the initialize() method before accessing data.'
			);
		}

		return this.#data;
	}

	constructor(pkg: Package) {
		this.#pkg = pkg;
		this.#file = join(this.#pkg.path, 'beyond-lock.json');
		this.initialize();
	}

	/**
	 * Asynchronously loads the lock file data.
	 */
	async initialize(): Promise<void> {
		if (this.#loaded) return;
		if (this.#loading) return await this.#loading;

		this.#loading = new PendingPromise();
		try {
			if (!(await this.#exists())) {
				// Use private exists check
				this.#data = null;
			} else {
				const content = await readFile(this.#file, 'utf-8');
				this.#data = JSON.parse(content) as ILockFile;
			}
			this.#loaded = true;
			this.#loading.resolve();
		} catch (error) {
			console.error(`Error initializing lock file at ${this.#file}: ${error.message}`);
			this.#data = null;
			this.#loaded = false;
			this.#loading.reject(error);
		}

		return await this.#loading;
	}

	/**
	 * Checks if the lock file exists.
	 */
	async #exists(): Promise<boolean> {
		// Renamed and made private
		try {
			await fs.promises.access(this.#file);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Saves the provided lock data to the lock file.
	 */
	async #save(data: ILockFile): Promise<void> {
		try {
			// Structure for sorting data - using descriptive names within the function scope
			const ordered = {
				content: {} as ILockFile, // Use a more descriptive name like 'content' or 'output'
				keys: Object.keys(data).sort()
			};

			for (const key of ordered.keys) {
				ordered.content[key] = data[key];
				if (ordered.content[key].dependencies) {
					const dependency = {
						sorted: {} as Record<string, ILockDependencySpec>,
						keys: Object.keys(ordered.content[key].dependencies!).sort()
					};
					for (const depKey of dependency.keys) {
						dependency.sorted[depKey] = ordered.content[key].dependencies![depKey];
					}
					ordered.content[key].dependencies = dependency.sorted;
				}
			}

			const content = JSON.stringify(ordered.content, null, 2);
			await writeFile(this.#file, content + '\n', 'utf-8');
			console.log(`Lock file saved successfully at ${this.#file}`);

			this.#data = ordered.content;
			this.#loaded = true;
		} catch (error) {
			console.error(`Error writing lock file: ${error.message}`);
		}
	}

	/**
	 * Generates the lock file data from a resolved dependency graph.
	 */
	async generate(graph: DependenciesGraph): Promise<ILockFile> {
		const lock: ILockFile = {};
		const traverse = (node: Node) => {
			const { version } = node;
			const key = node.package + (version.resolved ? `@${version.resolved}` : '');
			if ((node.error || version.error) && node.parent) {
				console.warn(`Node "${key}" has errors and is not being processed.`);
				return;
			}
			if (!version.resolved) {
				console.warn(`Node "${key}" does not have a resolved version and is not being processed.`);
				return;
			}

			if (lock[key]) return;

			const entry: ILockEntry = {
				name: node.package,
				version: { specified: version.specified, resolved: version.resolved },
				kind: node.kind
			};

			if (node.dependencies.size > 0) {
				entry.dependencies = {};
				for (const [name, dependency] of node.dependencies.entries()) {
					const { version } = dependency;

					// Skip dependencies with errors or unresolved versions
					if (!version.resolved) {
						console.warn(
							`Dependency "${name}" of node "${key}" does not have a resolved version and is not being included.`
						);
						continue;
					}
					if (dependency.error || version.error) {
						console.warn(
							`Dependency "${name}" of node "${key}" has errors or lacks a resolved version and is not being included.`
						);
						continue;
					}

					entry.dependencies[name] = {
						name,
						version: { specified: version.specified, resolved: version.resolved }
					};
				}

				// Clean up empty dependencies
				if (Object.keys(entry.dependencies).length === 0) {
					delete entry.dependencies;
				}
			}

			// Add the entry to the lock file
			lock[key] = entry;
			for (const child of node.dependencies.values()) {
				traverse(child);
			}
		};

		for (const child of graph.dependencies.values()) {
			traverse(child);
		}

		await this.#save(lock);
		return lock;
	}
}
