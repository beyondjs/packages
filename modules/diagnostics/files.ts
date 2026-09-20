import type { ISourcesInput } from './types';
import type { Paths } from './paths';
import type { Budget } from './budget';
import { readFileSync, readdirSync, statSync } from 'fs';

/**
 * Directories that never hold the sources of a module
 */
const SKIPPED = ['node_modules', 'builds'];

/**
 * The files one check reads: those supplied in memory first, then those of the locations the check is
 * allowed to read. A location outside of them does not exist for the compiler.
 */
export class Files {
	#paths: Paths;
	#memory: Map<string, string> = new Map();

	constructor(paths: Paths, sources?: ISourcesInput) {
		this.#paths = paths;

		Object.entries(sources?.files ?? {}).forEach(([relative, content]) => {
			const file = paths.absolute(relative);
			file && typeof content === 'string' && this.#memory.set(file, content);
		});
	}

	exists(file: string): boolean {
		if (this.#memory.has(file)) return true;
		if (!this.#paths.allowed(file)) return false;

		try {
			return statSync(file).isFile();
		} catch {
			return false;
		}
	}

	read(file: string): string | undefined {
		if (this.#memory.has(file)) return this.#memory.get(file);
		if (!this.#paths.allowed(file)) return;

		try {
			return readFileSync(file, 'utf8');
		} catch {
			return;
		}
	}

	/**
	 * The parsed content of a JSON file, or undefined when it is missing or malformed
	 */
	json(file: string): any {
		const content = this.read(file);
		if (content === void 0) return;

		try {
			return JSON.parse(content);
		} catch {
			return;
		}
	}

	directory(directory: string): boolean {
		if ([...this.#memory.keys()].some(file => file.startsWith(`${directory}/`))) return true;
		if (!this.#paths.allowed(directory)) return false;

		try {
			return statSync(directory).isDirectory();
		} catch {
			return false;
		}
	}

	/**
	 * The names of the directories of a directory
	 */
	directories(directory: string): string[] {
		if (!this.#paths.allowed(directory)) return [];

		try {
			return readdirSync(directory, { withFileTypes: true })
				.filter(entry => entry.isDirectory())
				.map(entry => entry.name);
		} catch {
			return [];
		}
	}

	/**
	 * The TypeScript sources under a directory of the package, including those supplied in memory
	 *
	 * @param directory The absolute directory of the module
	 * @param budget Counts every source found, so that an oversized module stops before it is compiled
	 */
	sources(directory: string, budget: Budget): string[] {
		const found: Set<string> = new Set();
		const source = (name: string) => /\.tsx?$/.test(name);

		const walk = (current: string) => {
			let entries;
			try {
				entries = readdirSync(current, { withFileTypes: true });
			} catch {
				return;
			}

			entries.forEach(entry => {
				const file = `${current}/${entry.name}`;
				if (entry.isDirectory()) {
					!entry.name.startsWith('.') && !SKIPPED.includes(entry.name) && walk(file);
				} else if (entry.isFile() && source(entry.name)) {
					found.add(file);
					budget.count();
				}
			});
		};
		this.#paths.allowed(directory) && walk(directory);

		const skipped = (file: string) =>
			file
				.slice(directory.length + 1)
				.split('/')
				.slice(0, -1)
				.some(name => name.startsWith('.') || SKIPPED.includes(name));

		[...this.#memory.keys()].forEach(file => {
			if (!file.startsWith(`${directory}/`) || !source(file) || skipped(file) || found.has(file)) return;
			found.add(file);
			budget.count();
		});

		return [...found].sort();
	}
}
