import type { IBuildable, IPublishedModule } from '../builds';
import type { Selection } from '../selection';
import { DevelopmentError } from '../error';
import { Addresses } from './addresses';
import { Externals } from './externals';
import { Graph, type IPreviewDiagnostic, type IPreviewModule, type IPreviewUpdatable } from './graph';
import { Document } from './document';

export /*bundle*/ interface IPreviewDescription {
	protocol: 'beyond-dev-files/1';
	entry: { specifier: string; vspecifier: string };

	/**
	 * The options of the modules in development
	 */
	options: string;
	cdn: { origin?: string; reason?: string };
	selection: { explicit: boolean };
	modules: IPreviewModule[];
	importmap: { imports: Record<string, string> };

	/**
	 * Whether the document registers a development runtime, which is what applies updates to the page while
	 * it runs. Without one the page shows new code only when it is loaded again, which is not an update.
	 */
	updates: { runtime?: string; session?: { options: string; modules: Record<string, IPreviewUpdatable> }; reason?: string };
	diagnostics: IPreviewDiagnostic[];
}

const WEB = { platform: 'web', environment: 'development' };

/**
 * The preview of the application of the served workspace: which public module is its entry, where each
 * module of its graph is loaded from, and the entry document that says so to a browser.
 */
export /*bundle*/ class Preview {
	/**
	 * The public module of a runtime package that connects a consumer to a development service. It is a
	 * provisional convention, like the route that delivers updates: a runtime package whose `bundle` the
	 * artifacts import publishes its coordinator as `main`.
	 */
	static COORDINATOR = 'main';

	#delivery: IBuildable;
	#selection: Selection;
	#addresses: Addresses;
	#externals: Externals;

	/**
	 * The entry that was last chosen without being named
	 */
	#chosen: string;

	constructor(delivery: IBuildable, selection: Selection, runtime?: string, environment: NodeJS.ProcessEnv = process.env) {
		this.#delivery = delivery;
		this.#selection = selection;
		this.#addresses = new Addresses(environment);
		this.#externals = new Externals(runtime);
	}

	/**
	 * The modules a preview can start from: the ones that are built for browsers and that no other public
	 * module of the workspace imports. The modules of a runtime are not applications. A browser module that
	 * does not build is a candidate too, and what it imports is unknown until it builds.
	 */
	async #candidates(published: IPublishedModule[]): Promise<{ roots: IPublishedModule[]; failures: IPreviewDiagnostic[] }> {
		const imported = new Set<string>();
		const browser: IPublishedModule[] = [];
		const failures: IPreviewDiagnostic[] = [];

		for (const module of published) {
			const { delivered, failure } = await this.#delivery.module(module, WEB);
			if (!delivered) {
				const diagnostics = failure.diagnostics ?? [failure];
				if (diagnostics.every(({ code }) => code === 'CONDITIONAL_NOT_FOUND')) continue;
				browser.push(module);
				diagnostics.forEach(({ code, message }) => failures.push({ code, message: `${Graph.specifier(module)}: ${message}` }));
				continue;
			}
			browser.push(module);
			(delivered.dependencies ?? []).forEach(({ vspecifier }) => vspecifier && imported.add(vspecifier));

			const runtime = delivered.runtime && Externals.parse(delivered.runtime).name;
			runtime && published.filter(({ name }) => name === runtime).forEach(one => imported.add(one.vspecifier));
		}
		return { roots: browser.filter(({ vspecifier }) => !imported.has(vspecifier)), failures };
	}

	async #entry(requested: string | undefined, published: IPublishedModule[]): Promise<IPublishedModule> {
		if (requested) {
			const found = published.find(module => Graph.specifier(module) === requested || module.vspecifier === requested);
			if (found) return found;
			throw new DevelopmentError('PREVIEW_ENTRY_NOT_FOUND', `The workspace declares no public module "${requested}"`, 404);
		}

		const { roots, failures } = await this.#candidates(published);
		if (roots.length === 1) {
			this.#chosen = Graph.specifier(roots[0]);
			return roots[0];
		}

		// A module that stopped building no longer says what it imports, so the modules it imported look like
		// entries too: the entry that was unambiguous before the error is still the entry
		const previous = failures.length ? roots.find(module => Graph.specifier(module) === this.#chosen) : void 0;
		if (previous) return previous;

		const names = roots.map(Graph.specifier);
		const message = names.length
			? `Several public modules can be the entry of the preview: name one with "entry" (${names.join(', ')})`
			: 'No public module of the workspace is built for browsers, so there is nothing to preview';
		throw new DevelopmentError('PREVIEW_ENTRY_REQUIRED', message, 409, { candidates: names, diagnostics: failures });
	}

	/**
	 * @param requested The public specifier of the entry module. Without it the entry is the only public
	 * module that builds for browsers and that nothing else imports.
	 */
	async describe(requested?: string): Promise<IPreviewDescription> {
		await this.#delivery.refresh?.();
		const published = await this.#delivery.published();
		const entry = await this.#entry(requested, published);

		// The selection is read once, so every module of one description is routed by the same selection
		const selection = await this.#selection.read();
		const graph = new Graph(this.#delivery, module => this.#selection.covers(selection, module), this.#addresses, this.#externals);
		await graph.walk([entry], published);

		// The coordinator of a runtime that the workspace contains is loaded by the document, not by the application
		const coordinators = graph.runtimes
			.map(runtime => `${Externals.parse(runtime).name}/${Preview.COORDINATOR}`)
			.map(specifier => published.find(module => Graph.specifier(module) === specifier))
			.filter(module => !!module);
		await graph.walk(coordinators, published);
		const coordinator = coordinators.length ? Graph.specifier(coordinators[0]) : await this.#delivered(graph, entry);

		// The runtime of a page is given the part of the session it needs, so a visitor, whose grant does
		// not read the session of the service, is never asked for it: what the modules in development are
		// and how their updates are requested, all of which the import map already tells that visitor
		const session = { options: this.#addresses.options, modules: graph.updatable };
		const updates = coordinator
			? { runtime: coordinator, session }
			: { reason: `The runtime of the application (${graph.runtimes.join(', ') || 'none'}) has no development coordinator in this workspace or on the CDN, so nothing applies updates to the running page` };

		const { modules, diagnostics } = graph;
		const imports: Record<string, string> = {};
		modules.forEach(({ specifier, url }) => url && (imports[specifier] = url));

		const { cdn } = this.#addresses;
		return {
			protocol: 'beyond-dev-files/1',
			entry: { specifier: Graph.specifier(entry), vspecifier: entry.vspecifier },
			options: this.#addresses.options,
			cdn: cdn ? { origin: cdn } : { reason: `${Addresses.VARIABLE} is not set: modules that are not in development have no address` },
			selection: { explicit: selection.explicit },
			modules,
			importmap: { imports },
			updates,
			diagnostics
		};
	}

	/**
	 * The coordinator of a runtime that the workspace does not contain, delivered by the CDN at the version
	 * the runtime resolves to, like the runtime itself
	 *
	 * @returns Its specifier, or undefined when it has no address
	 */
	async #delivered(graph: Graph, entry: IPublishedModule): Promise<string | undefined> {
		for (const runtime of graph.runtimes) {
			const specifier = `${Externals.parse(runtime).name}/${Preview.COORDINATOR}`;
			// A runtime without a coordinator, such as the Kernel, is never asked for one
			if (!(await this.#externals.exports(specifier, entry.path))) continue;
			const module = await graph.runtime(specifier, entry);
			if (module?.url) return specifier;
		}
	}

	async document(requested?: string): Promise<string> {
		return new Document(await this.describe(requested)).html;
	}
}
