import * as ts from 'typescript';
import { join } from 'path';

/**
 * Virtual directories whose `node_modules` hold the packages that one importer reaches for one name.
 *
 * TypeScript resolves a bare specifier by looking for `node_modules/<name>`, and then for
 * `node_modules/@types/<name>`, from the directory of the importing file, and reads the manifest, the
 * `exports`, the `types` and the files of what it finds. A package of the installed graph is in no
 * `node_modules`: its sources are at the location of its node. A slot is a directory under `Slots.ROOT`,
 * one for each importer and name, whose `node_modules/<name>` is the location of the node the importer's edge
 * reaches; resolving from a file of the slot lets TypeScript apply its own resolution to that package, and
 * the real path of what it finds is the file inside the node.
 *
 * As a resolution host it answers for the slots and for the real file system, except that it refuses every
 * other `node_modules` directory: nothing a program resolves through it comes from outside the graph.
 */
export class Slots {
	static ROOT = '/beyond/graph/';

	#directory: string;

	// The packages of each slot by name, under the directory of the slot
	#slots: Map<string, Map<string, string>> = new Map();
	#ids: Map<string, string> = new Map();

	#host: ts.ModuleResolutionHost;

	/**
	 * The host TypeScript resolves modules and type references through
	 */
	get host(): ts.ModuleResolutionHost {
		return this.#host;
	}

	/**
	 * @param directory The current directory of the program
	 */
	constructor(directory: string) {
		this.#directory = directory;

		const { sys } = ts;
		this.#host = {
			fileExists: file => {
				const mapped = this.#map(file);
				if (mapped !== void 0) return !!mapped && sys.fileExists(mapped);
				return !Slots.#installed(file) && sys.fileExists(file);
			},
			readFile: file => {
				const mapped = this.#map(file);
				if (mapped !== void 0) return mapped ? sys.readFile(mapped) : void 0;
				return Slots.#installed(file) ? void 0 : sys.readFile(file);
			},
			directoryExists: directory => {
				const virtual = this.#virtual(directory);
				if (virtual !== void 0) return virtual;
				return !Slots.#installed(directory) && sys.directoryExists(directory);
			},
			realpath: path => {
				const mapped = this.#map(path);
				const real = mapped ?? path;
				return sys.realpath ? sys.realpath(real) : real;
			},
			getDirectories: path => {
				const mapped = this.#map(path);
				if (mapped !== void 0) return mapped ? sys.getDirectories(mapped) : [];
				return Slots.#installed(path) ? [] : sys.getDirectories(path);
			},
			getCurrentDirectory: () => this.#directory
		};
	}

	/**
	 * Whether a real path is inside a `node_modules` directory, which no resolution through the graph reads
	 */
	static #installed(path: string): boolean {
		return path.replace(/\\/g, '/').split('/').includes('node_modules');
	}

	/**
	 * A file of the slot of an importer and a name, whose `node_modules` holds the given packages
	 *
	 * @param id What tells the slot apart: the importer and the name it imports
	 * @param packages The location of each package by the name it has in `node_modules`
	 * @returns The path of a file of the slot, to resolve from
	 */
	file(id: string, packages: Map<string, string>): string {
		let directory = this.#ids.get(id);
		if (!directory) {
			directory = `${Slots.ROOT}${this.#ids.size}`;
			this.#ids.set(id, directory);
		}
		this.#slots.set(directory, packages);
		return `${directory}/index.ts`;
	}

	/**
	 * The parts of a path of a slot after its root, or undefined for a path outside the slots
	 */
	static #parts(path: string): string[] | undefined {
		const normalized = path.replace(/\\/g, '/');
		if (!normalized.startsWith(Slots.ROOT) && `${normalized}/` !== Slots.ROOT) return;
		return normalized.slice(Slots.ROOT.length).split('/').filter(Boolean);
	}

	/**
	 * The real path that a path inside a package of a slot stands for: null for a path of the slots that
	 * stands for nothing, undefined for a path outside the slots
	 */
	#map(path: string): string | null | undefined {
		const parts = Slots.#parts(path);
		if (!parts) return;

		const [slot, modules, ...rest] = parts;
		const packages = this.#slots.get(`${Slots.ROOT}${slot}`);
		if (!packages || modules !== 'node_modules' || !rest.length) return null;

		const length = rest[0].startsWith('@') ? 2 : 1;
		const location = rest.length >= length ? packages.get(rest.slice(0, length).join('/')) : void 0;
		return location ? join(location, ...rest.slice(length)) : null;
	}

	/**
	 * Whether a directory of the slots exists: the slot, its `node_modules`, a scope of a package it holds and
	 * whatever exists inside a package it holds. Undefined for a directory outside the slots.
	 */
	#virtual(directory: string): boolean | undefined {
		const parts = Slots.#parts(directory);
		if (!parts) return;
		if (!parts.length) return true;

		const packages = this.#slots.get(`${Slots.ROOT}${parts[0]}`);
		if (!packages) return false;
		if (parts.length === 1) return true;
		if (parts[1] !== 'node_modules') return false;
		if (parts.length === 2) return true;
		if (parts.length === 3 && parts[2].startsWith('@')) return [...packages.keys()].some(name => name.startsWith(`${parts[2]}/`));

		const mapped = this.#map(directory);
		return !!mapped && ts.sys.directoryExists(mapped);
	}
}
