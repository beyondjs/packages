import type { Delivery } from '@beyond-js/packages/artifacts';
import { Identity, ModulePath, Options, Resolution, ResourcePath } from '@beyond-js/artifact-api';
import type { Sources } from '../modules/sources';
import { Kinds } from '../modules/kinds';
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
 * mapped in the browser document only. For browsers it
 * adds what their builds import from
 * installed packages and the stylesheets they select (`Walk`): an installed package is resolved from the package
 * that imports it, at its installed version and under the source its lockfile recorded, and walked in turn.
 * When two importers resolve one specifier to different installations, the first keeps `imports` and the other
 * gets a scope, as a release does. This service compiles installed packages for browsers only, and a Node
 * consumer resolves them from its installation, which is why the node document lists the modules this service
 * builds for Node and nothing installed. Nothing here is kept: the document follows the workspace.
 */
export class Resolver {
	#delivery: Delivery;
	#sources: Sources;

	constructor(delivery: Delivery, sources: Sources) {
		this.#delivery = delivery;
		this.#sources = sources;
	}

	/**
	 * @param target `browser` or `node`
	 * @param format `esm` or `system`
	 */
	async build(target: string, format: string): Promise<Resolution> {
		const options = new Options({ target, format, env: 'development', min: 'false', sourcemap: 'inline' });
		const table = new Table();
		const walk = new Walk(this.#delivery, this.#sources, options, table);

		const published = await this.#delivery.published();
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
			if (delivered && target === 'browser') await walk.dependencies(delivered, { path: module.path, prefix: Walk.prefix(path) });
		}

		const { imports, scopes } = table;
		return new Resolution({ protocol: Resolution.PROTOCOL, target, format, imports, scopes });
	}
}
