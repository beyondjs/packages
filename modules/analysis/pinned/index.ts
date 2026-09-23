import type { IDiagnostic } from '@beyond-js/packages/types';
import { Publication } from '@beyond-js/packages/publication';
import { promises as fs } from 'fs';
import { join } from 'path';
import { builtinModules } from 'module';
import type { IAnalysisConditions, IGraph, IFetched, SourcesType } from '../types';
import { Graph } from '../graph';
import { Specifier } from '../specifier';
import type { Opened, IPublicModule } from './opened';
import { SourcePackage } from './source';
import { DistributedPackage } from './distributed';
import { NpmPackage } from './npm';
import { Output } from './output';

/**
 * Where a public specifier imported from a package lands in the pinned inputs
 */
export /*bundle*/ interface ILanding {
	builtin?: boolean;
	opened?: Opened;
	module?: IPublicModule;

	/**
	 * The output of the module the specifier selects: `js` unless an explicit `.css` selects its stylesheet
	 */
	output?: 'js' | 'css';
	warnings: IDiagnostic[];
	diagnostics: IDiagnostic[];
}

/**
 * The pinned inputs of an analysis or a generation: the graph, the extracted root of each of its packages
 * and the packages opened so far.
 *
 * It resolves public specifiers the only way they may be resolved here: along the edges of the graph, into
 * the directories that were already fetched. It downloads nothing and selects no version. Whoever creates
 * it destroys it, which releases the packages it opened.
 */
export /*bundle*/ class Pinned {
	#graph: Graph;
	get graph() {
		return this.#graph;
	}

	#sources: Map<string, string | IFetched>;
	#conditions: IAnalysisConditions;
	get conditions() {
		return this.#conditions;
	}

	#opened: Map<string, Promise<{ opened?: Opened; diagnostics: IDiagnostic[] }>> = new Map();

	constructor(graph: IGraph, sources: SourcesType, conditions: IAnalysisConditions) {
		this.#graph = new Graph(graph);
		// What a fetch answers is accepted as it is: a list of packages, each with its key
		const listed = sources instanceof Array ? sources.map(fetched => <[string, IFetched]>[fetched.key, fetched]) : Object.entries(sources ?? {});
		this.#sources = sources instanceof Map ? sources : new Map(listed);

		const platform = conditions?.platform === 'web' ? 'browser' : conditions?.platform;
		this.#conditions = { platform, environment: conditions?.environment };
	}

	/**
	 * Opens the package of a node in the form its manifest declares
	 */
	open(key: string): Promise<{ opened?: Opened; diagnostics: IDiagnostic[] }> {
		!this.#opened.has(key) && this.#opened.set(key, this.#open(key));
		return this.#opened.get(key);
	}

	async #open(key: string): Promise<{ opened?: Opened; diagnostics: IDiagnostic[] }> {
		const fail = (code: string, message: string) => ({ diagnostics: [{ code, message }] });
		const node = this.#graph.node(key);
		if (!node) return fail('PACKAGE_NOT_PINNED', `"${key}" is not a node of the pinned graph`);

		const fetched = this.#sources.get(key);
		const root = typeof fetched === 'string' ? fetched : fetched?.extracted;
		if (!root) return fail('SOURCES_MISSING', `The sources of "${key}" were not provided. Fetch every package of the graph before analysing it`);

		let manifest: Record<string, any>;
		try {
			manifest = JSON.parse(await fs.readFile(join(root, 'package.json'), 'utf8'));
		} catch (exc) {
			// The reason is reported by its code: the message of the system names the extraction directory
			return fail('MANIFEST_UNREADABLE', `The manifest of "${key}" cannot be read (${exc.code ?? 'invalid JSON'})`);
		}

		const publication = Publication.read(manifest);
		if (!publication.form) return { diagnostics: publication.diagnostics };

		const Form = { source: SourcePackage, distribution: DistributedPackage, npm: NpmPackage }[publication.form];
		const integrity = typeof fetched === 'string' ? void 0 : fetched.integrity;
		return { opened: new Form(key, root, node, manifest, publication, integrity), diagnostics: [] };
	}

	/**
	 * Follows a public specifier imported by a package of the graph
	 *
	 * @param from The key of the importing node
	 * @param hint `context`: the key of the node that reached the importing one, which selects its peers;
	 * `key`: the node an inventory already resolved the package to; `css`: the reference is a stylesheet
	 * whatever its spelling, which is how a distribution declares one
	 */
	async land(from: string, specifier: string, hint: { context?: string; key?: string; css?: boolean } = {}): Promise<ILanding> {
		const warnings: IDiagnostic[] = [];
		const name = specifier.replace(/^node:/, '');
		if (specifier.startsWith('node:') || builtinModules.includes(name)) return { builtin: true, warnings, diagnostics: [] };

		const parsed = new Specifier(specifier);
		if (!parsed.valid) return { warnings, diagnostics: [{ code: 'SPECIFIER_INVALID', message: `"${specifier}" is not a public specifier` }] };

		// A resolution that was already frozen for the importer is followed as it is
		const { key, warning, error } = hint.key && this.#graph.node(hint.key) ? { key: hint.key } : this.#graph.resolve(from, parsed.name, hint.context);
		warning && warnings.push(warning);
		if (error) return { warnings, diagnostics: [error] };

		const { opened, diagnostics } = await this.open(key);
		if (!opened) return { warnings, diagnostics };

		const found = await Output.select(opened, parsed, this.#conditions, hint.css);
		return { opened, module: found.module, output: found.output, warnings, diagnostics: found.diagnostics };
	}

	destroy(): void {
		this.#opened.forEach(promise => promise.then(({ opened }) => opened?.destroy()).catch(() => void 0));
		this.#opened.clear();
	}
}
