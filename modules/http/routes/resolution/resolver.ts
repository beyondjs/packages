import type { Delivery } from '@beyond-js/packages/artifacts';
import { ContractError, Identity, ModulePath, Options, Resolution, ResourcePath } from '@beyond-js/artifact-api';
import type { Sources } from '../modules/sources';
import { Kinds } from '../modules/kinds';
import { Instances } from '../instances';
import { Edges } from './edges';
import { Table } from './table';
import { Walk } from './walk';

/**
 * The `beyond-resolution/1` document of a development service, for one target and format: which URL of this
 * service delivers each public specifier, with the development options of that target.
 *
 * It is computed from what the session describes: the public modules of the workspace and of the packages the
 * toolchain supplies, every one that declares the target. A specifier selects the JavaScript of a module, and
 * `<specifier>.css` its stylesheet, when it has one: a style module has no JavaScript, only `.css`, and a
 * package that publishes the literal subpath `./x.css` is given that module for `pkg/x.css`. Stylesheets are
 * mapped in the browser document only. For browsers it adds what their builds import from installed packages and
 * the stylesheets they select: an installed package is resolved from the package that imports it, at its
 * installed version and under the source its lockfile recorded, and walked in turn (`Walk`). When two importers
 * resolve one specifier to different installations, the first keeps `imports` and the other gets a scope, as a
 * release does. This service compiles installed packages for browsers only, and a Node consumer resolves them
 * from its installation, which is why the node document lists the modules this service builds for Node and
 * nothing installed. Nothing here is kept: the document follows the workspace.
 *
 * A workspace served from its execution projection (`beyond install`) is walked by the edges of its installed
 * graph instead (`Edges`): every importer is an instance of the graph, and nothing is looked up on the disk; a
 * specifier that several local versions publish has no import, only its importers' scopes (`Table`). A
 * document that would give one instance two releases of a peer, or a runtime the installed graph does not have
 * once, is refused (`BUILD_FAILED`, with a `PEER_CONTEXT_AMBIGUOUS` or `RUNTIME_NOT_INSTALLED` diagnostic for each
 * binding it cannot hold).
 */
export class Resolver {
	#delivery: Delivery;
	#sources: Sources;

	constructor(delivery: Delivery, sources: Sources) {
		this.#delivery = delivery;
		this.#sources = sources;
	}

	/**
	 * Whether a specifier (or its `.css`) belongs to a package several local versions of the workspace publish
	 */
	static #shared(published: { name: string; version: string }[]): (specifier: string) => boolean {
		const versions = new Map<string, Set<string>>();
		published.forEach(({ name, version }) => versions.set(name, (versions.get(name) ?? new Set()).add(version)));
		return specifier => (versions.get(Walk.parse(specifier.replace(/\.css$/, '')).name)?.size ?? 0) > 1;
	}

	/**
	 * @param target `browser` or `node`
	 * @param format `esm` or `system`
	 * @throws ContractError BUILD_FAILED when the installed graph binds one instance in two ways in this document
	 */
	async build(target: string, format: string): Promise<Resolution> {
		const options = new Options({ target, format, env: 'development', min: 'false', sourcemap: 'inline' });
		const published = await this.#delivery.published();
		const instances = Instances.of(this.#delivery);
		const table = new Table(instances && Resolver.#shared(published));
		const edges = instances && new Edges(this.#delivery, instances, options, table);
		const walk = new Walk(this.#delivery, this.#sources, options, table);

		const literal = new Set(published.map(({ specifier }) => specifier).filter(specifier => specifier.endsWith('.css')));
		const stylesheet = (identity: Identity) => `${ResourcePath.format({ kind: 'style', identity })}?${options.query}`;

		for (const module of published) {
			const { name, version, subpath, specifier } = module;
			const identity = new Identity({ name, version, subpath });
			// Stylesheets are for a document: the node document maps code only
			const browser = target === 'browser';
			if (literal.has(specifier)) {
				browser && table.add(specifier, stylesheet(identity));
				continue;
			}

			// A style module has no JavaScript: its code is never compiled, and the delivery refuses to select it
			const declared = await Kinds.style(module);
			const { delivered, failure } = declared ? <{ delivered?: undefined; failure?: undefined }>{} : await this.#delivery.module(module, options.conditions);
			const codes = failure?.diagnostics?.map(({ code }) => code) ?? [];
			if (codes.length && codes.every(code => code === 'CONDITIONAL_NOT_FOUND')) continue;
			const style = declared || codes.includes('OUTPUT_NOT_FOUND');
			const path = ModulePath.format(identity);
			!style && table.add(specifier, `${path}?${options.query}`);
			if (browser && (style || delivered?.styles) && !literal.has(`${specifier}.css`)) table.add(`${specifier}.css`, stylesheet(identity));
			if (!delivered || !browser) continue;
			edges ? await edges.root(module, delivered, path) : await walk.dependencies(delivered, { path: module.path, prefix: Walk.prefix(path) });
		}

		const diagnostics = edges?.diagnostics ?? [];
		if (diagnostics.length) {
			const hint = diagnostics.some(({ code }) => code === 'PEER_CONTEXT_AMBIGUOUS') ? '. Load each application through its own preview' : '';
			const message = `The installed graph cannot be written as one resolution of the workspace: ${diagnostics[0].message}${hint}`;
			throw new ContractError('BUILD_FAILED', message, { diagnostics });
		}

		const { imports, scopes } = table;
		return new Resolution({ protocol: Resolution.PROTOCOL, target, format, imports, scopes });
	}
}
