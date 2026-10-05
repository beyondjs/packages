import type { IDiagnostic } from '@beyond-js/packages/types';
import type { Execution, IExecutionNode } from '@beyond-js/packages/execution';
import { Imports } from '@beyond-js/packages/workspace';
import { createRequire } from 'module';
import { existsSync, readFileSync, realpathSync } from 'fs';
import { dirname, join } from 'path';
import { pathToFileURL } from 'url';

/**
 * Where one installed package is
 */
export interface IInstance {
	/**
	 * The real directory of the root of the package, when it was found
	 */
	location?: string;

	/**
	 * With an execution: the key of the node of the installed graph the package is
	 */
	key?: string;

	/**
	 * With an execution: that node
	 */
	node?: IExecutionNode;

	/**
	 * Why the package has no location: `PACKAGE_NOT_FOUND`, `INSTANCE_NAME_CONFLICT` for one name and version
	 * that several nodes claim, `SOURCE_MISSING` for a node whose sources are not on disk
	 */
	failure?: IDiagnostic;
}

/**
 * Where the installed packages of a workspace are.
 *
 * With the execution projection of an installed graph, an installed package is an external node of that
 * graph, located by its name and version, or by its key, at the canonical location of its sources. Nothing
 * else is searched: neither the directories of the workspace packages, nor the toolchain's installation, nor
 * the working directory. Which package an importer reaches is not answered here: serving binds it by the
 * instances that reached the importer.
 *
 * Without one, a package is found where Node finds it from a list of directories, and only at the exact
 * version that was requested.
 */
export class Instances {
	#bases: () => string[];

	#execution: Execution | undefined;
	get execution() {
		return this.#execution;
	}

	/**
	 * @param bases The directories to resolve installed packages from without an execution
	 * @param execution The execution projection of the installed graph
	 */
	constructor(bases: () => string[], execution?: Execution) {
		this.#bases = bases;
		this.#execution = execution;
	}

	/**
	 * The root of an installed package by name, as Node finds it from a directory. A package whose `exports`
	 * hide its manifest is found from its entry point, walking up to the manifest that carries its name.
	 */
	static root(name: string, from: string): string | undefined {
		const require = createRequire(pathToFileURL(join(from, 'noop.js')).href);
		try {
			return dirname(require.resolve(`${name}/package.json`));
		} catch (error) {
			if (error.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') return;
		}
		try {
			for (let current = dirname(require.resolve(name)); dirname(current) !== current; current = dirname(current)) {
				const manifest = join(current, 'package.json');
				if (existsSync(manifest) && JSON.parse(readFileSync(manifest, 'utf8')).name === name) return current;
			}
		} catch {
			return;
		}
	}

	/**
	 * The version of the package at a root, or undefined when its manifest cannot be read
	 */
	static version(root: string): string | undefined {
		try {
			return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
		} catch {
			return;
		}
	}

	/**
	 * The real path of a directory, or undefined when it does not exist
	 */
	static #real(path: string): string | undefined {
		try {
			return realpathSync(path);
		} catch {
			return;
		}
	}

	/**
	 * Where a package is installed at exactly the requested version
	 *
	 * @param key With an execution, the node to locate, which must be of that name and version
	 */
	locate(name: string, version: string, key?: string): IInstance {
		if (this.#execution) return this.#node(this.#execution, name, version, key);

		for (const base of this.#bases()) {
			const root = Instances.root(name, base);
			if (root && Instances.version(root) === version) return { location: realpathSync(root) };
		}
		return { failure: { code: 'PACKAGE_NOT_FOUND', message: `"${name}@${version}" is neither a package of the workspace nor installed for it` } };
	}

	#node(execution: Execution, name: string, version: string, key?: string): IInstance {
		const keys = key ? [key] : execution.find(name, version);
		const nodes = keys
			.map(one => ({ key: one, node: execution.node(one) }))
			.filter(({ key: one, node }) => node && node.name === name && node.version === version && !Imports.member(one, node));

		if (!nodes.length) {
			const which = key ? `the node ${key} of` : 'a package of';
			return { failure: { code: 'PACKAGE_NOT_FOUND', message: `"${name}@${version}" is not ${which} the installed graph` } };
		}
		if (nodes.length > 1) {
			const message = `"${name}@${version}" is more than one node of the installed graph (${nodes.map(one => one.key).join(', ')}), which cannot be told apart`;
			return { failure: { code: 'INSTANCE_NAME_CONFLICT', message } };
		}

		const [found] = nodes;
		const location = Instances.#real(found.node.location);
		if (location) return { location, ...found };

		const message = `The sources of ${found.key} are missing at ${found.node.location}: run beyond install`;
		return { ...found, failure: { code: 'SOURCE_MISSING', message } };
	}
}
