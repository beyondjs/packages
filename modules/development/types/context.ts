import { realpathSync } from 'fs';
import type { IServedExecution } from '../builds';
import type { Instances } from '../preview/instances';
import { DevelopmentError } from '../error';
import type { Installations } from './installations';
import type { Modules } from './modules';
import { TypesRequest } from './request';

/**
 * Where a type check resolves a bare specifier from: the importer chain that names it (`label`, which the references
 * of an answer repeat), and the directory resolution starts at or, in an installed workspace, the instance of the
 * installed graph with the instances that reached it, nearest first
 */
export interface IContext {
	label: string;
	directory?: string;
	key?: string;
	chain: string[];
}

/**
 * The context of an importer chain (`TypesRequest.chain`): its first element is `.` (the root of the workspace) or a
 * public module or package of the workspace; each further element is a package the previous one imports, found as
 * the type check finds it. In an installed workspace each step follows the edges of the installed graph, with the
 * peers its chain decides, and the root is a context only when it is itself a member.
 */
export class Contexts {
	#root: string;
	#modules: Modules;
	#instances: Instances | undefined;
	#execution: IServedExecution | undefined;
	#installations: Installations;

	/**
	 * @param specs The served root, the published modules, the installed graph when the workspace has one, and where
	 * packages are installed when it has none
	 */
	constructor(specs: { root: string; modules: Modules; instances?: Instances; execution?: IServedExecution; installations: Installations }) {
		this.#root = specs.root;
		this.#modules = specs.modules;
		this.#instances = specs.instances;
		this.#execution = specs.execution;
		this.#installations = specs.installations;
	}

	/**
	 * @throws DevelopmentError `400 TYPES_REQUEST_INVALID` or `404 DECLARATION_NOT_FOUND` for an importer that cannot be
	 * a context
	 */
	async of([first, ...packages]: string[]): Promise<IContext> {
		let context = this.#first(first);
		for (const name of packages) context = await this.#step(context, name);
		return context;
	}

	static #missing(message: string, details: Record<string, unknown> = {}): DevelopmentError {
		return new DevelopmentError('DECLARATION_NOT_FOUND', message, 404, details);
	}

	#first(element: string): IContext {
		const instances = this.#instances;
		if (element === '.') {
			if (!instances) return { label: '.', directory: this.#root, chain: [] };
			const key = this.#execution?.instance(Contexts.#canonical(this.#root));
			if (!key) {
				const message = 'An installed workspace resolves a package through the edges of the package that imports it: name the importer';
				throw new DevelopmentError('TYPES_REQUEST_INVALID', message, 400);
			}
			return { label: '.', directory: this.#root, key, chain: [] };
		}

		const module = this.#modules.importer(TypesRequest.parse(element));
		if (!module) throw Contexts.#missing(`The importer "${element}" is not a public module or package of the workspace`);
		const label = `${module.name}@${module.version}`;
		if (!instances) return { label, directory: module.path, chain: [] };

		const key = instances.importer(module);
		const message = `"${label}" is not part of the installed graph of the workspace, which resolves what it imports: run beyond install`;
		if (!key) throw Contexts.#missing(message, { reason: 'DEPENDENCY_NOT_INSTALLED' });
		return { label, directory: module.path, key, chain: [] };
	}

	async #step(context: IContext, name: string): Promise<IContext> {
		const label = `${context.label} > ${name}`;
		const instances = this.#instances;
		if (instances) {
			const bound = instances.bind(context.key, name, context.chain);
			if (!bound.node) throw Contexts.#missing(`${context.label} does not reach "${name}": ${bound.error?.message}`, { reason: bound.error?.code });
			return { label, directory: bound.node.location, key: bound.key, chain: instances.extend(context.key, context.chain) };
		}

		// A package of the workspace is where its sources are, wherever the importer is
		const member = this.#modules.of(name);
		if (member?.path) return { label, directory: member.path, chain: [] };
		const found = await this.#installations.locate(name, context.directory);
		if (!found) throw Contexts.#missing(`"${name}" is not installed for ${context.label}`);
		return { label, directory: found.root, chain: [] };
	}

	/**
	 * A directory as the installed graph names it: its real path
	 */
	static #canonical(path: string): string {
		try {
			return realpathSync(path);
		} catch {
			return path;
		}
	}
}
