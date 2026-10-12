import type { IDiagnostic, IConditions } from '@beyond-js/packages/types';
import type { Package } from '@beyond-js/packages/package';
import { Publication, type IPublication } from '@beyond-js/packages/publication';
import { SourcePackage, type IGraphNode, type IPublicModule } from '@beyond-js/packages/analysis';
import { Confinement } from '@beyond-js/packages/confinement';
import type { IInstance } from './instances';

/**
 * The form an installed package declares (`beyond-publication/1`), and the package opened as Beyond sources when it
 * is one
 */
export interface IAuthoredForm {
	publication: IPublication;
	opened?: SourcePackage;
}

/**
 * How one public module of a package published as Beyond sources is compiled, or why it is not
 */
export interface IAuthoredModule {
	/**
	 * The package, when a bundler of its own composes the module: it is compiled as a member of the workspace is
	 */
	composed?: Package;

	/**
	 * A module of the packaging bundler, or of none: its entry point and the directory its inputs are named from,
	 * the root of its package, and the entry points of its other public modules, which stay references
	 */
	packaged?: { module: IPublicModule; root: string; entries: Map<string, string> };

	failure?: IDiagnostic & { diagnostics?: IDiagnostic[] };
}

/**
 * The nodes of an installed graph whose packages are published as Beyond sources, compiled by the bundlers they
 * declare.
 *
 * A package declares how its public modules are compiled, and whoever compiles it for a browser honours that
 * declaration, as the preparation of a package for delivery does. A node whose manifest declares the source form is
 * opened as the preparation opens a pinned package ([SourcePackage](../analysis/pinned/source.ts)): read from the
 * canonical location of its sources with the identity of its node (its key and integrity), which is what the
 * identifiers of its components derive from, and compiled confined, because its sources come from a registry and
 * not from the person: no bundler, processor or compiler it names is loaded unless the toolchain ships it, and no
 * file outside it is read.
 *
 * - A module that a bundler of the package composes (the `ts` bundler) is compiled by that bundler, through the
 *   same compilation a member of the workspace goes through, with its development and production conditionals.
 * - A module of the packaging bundler, or of none, is compiled by the compiler of this environment from the entry
 *   point its manifest declares, the other public modules of its package staying references.
 * - A module whose declared bundler cannot be used — not registered, not shipped by the toolchain, or not
 *   importable — is refused with the reason, and no other compiler takes its place.
 *
 * Nothing else is opened here: an ordinary npm package and a distribution are compiled from their `exports` by the
 * packaging path, and a declaration that cannot be read selects no form and is refused with its diagnostics. A
 * package is opened once for a node at one location, and again when the manifest there was written anew.
 */
export class Authored {
	#forms: Map<string, { stamp: string; form: IAuthoredForm }> = new Map();

	/**
	 * The form the package of an installed node declares
	 *
	 * @param manifest The manifest read from the location of the node
	 * @param stamp When that manifest was written: a package whose sources were replaced is opened again
	 */
	form(instance: IInstance, manifest: Record<string, any>, stamp: string): IAuthoredForm {
		const { key, location } = instance;
		const id = `${key}\n${location}`;
		const kept = this.#forms.get(id);
		if (kept?.stamp === stamp) return kept.form;
		kept?.form.opened?.destroy();

		const publication = Publication.read(manifest);
		const node = <IGraphNode>(<unknown>instance.node);
		// Confined: its sources come from a registry, so nothing it names runs here unless the toolchain ships it
		const source = publication.form === 'source';
		const opened = source ? new SourcePackage(key, location, node, manifest, publication, node.integrity ?? void 0, true) : void 0;
		const form = opened ? { publication, opened } : { publication };
		this.#forms.set(id, { stamp, form });
		return form;
	}

	/**
	 * How a public module of a package published as Beyond sources is compiled
	 */
	async module(opened: SourcePackage, subpath: string, conditions: IConditions): Promise<IAuthoredModule> {
		const pkg = await opened.read();
		if (!pkg.valid) return Authored.#refused(`The package of ${opened.key} cannot be read`, pkg.errors);

		// A declared bundler that cannot be used is the answer: no other compiler takes its place
		const spec = pkg.modules.specs.get(subpath);
		const named = spec?.bundler && spec.bundler !== 'exports';
		if (named && !pkg.modules.has(subpath)) {
			const bundler = (<{ get(name: string): { errors?: IDiagnostic[] } | undefined }>(<unknown>pkg.bundlers))?.get(spec.bundler);
			const diagnostics = [...(bundler?.errors ?? []), ...(pkg.modules.resolver(subpath)?.errors ?? [])];
			const label = Authored.#label(opened, subpath);
			return Authored.#refused(`${label} of ${opened.key} declares the bundler "${spec.bundler}", which cannot compile it here`, diagnostics);
		}

		const composed = await opened.composed(subpath);
		if (composed) {
			if (Confinement.COMPOSERS.includes(composed.specifier)) return { composed: pkg };
			return { failure: Confinement.plugin('bundler', composed.specifier) };
		}

		// The entry point, the platforms and the confinement of the module are checked as the preparation checks them
		const analysis = { platform: conditions.platform === 'web' ? 'browser' : conditions.platform, environment: conditions.environment };
		const { module, diagnostics } = await opened.module(subpath, analysis);
		if (!module?.entry) return Authored.#refused(void 0, diagnostics.length ? diagnostics : [{ code: 'MODULE_ENTRY_MISSING', message: `${Authored.#label(opened, subpath)} declares no entry point` }]);
		return { packaged: { module, root: opened.root, entries: await opened.entries(analysis, subpath) } };
	}

	static #label(opened: SourcePackage, subpath: string): string {
		return `"${subpath === '.' ? opened.name : `${opened.name}/${subpath.replace(/^\.\//, '')}`}"`;
	}

	/**
	 * A failure that keeps the code of its first diagnostic, and every diagnostic
	 *
	 * @param message What failed, which the first diagnostic explains; without it, that diagnostic says it all
	 */
	static #refused(message: string | undefined, diagnostics: IDiagnostic[]): IAuthoredModule {
		const [first] = diagnostics;
		const code = first?.code ?? 'BUILD_FAILED';
		const text = message && first ? `${message}: ${first.message}` : (message ?? first?.message);
		return { failure: { code, message: text, diagnostics } };
	}

	/**
	 * Releases every package opened, which no compilation uses afterwards
	 */
	destroy(): void {
		this.#forms.forEach(({ form }) => form.opened?.destroy());
		this.#forms.clear();
	}
}
