import type { Files } from '../files';
import type { IBuildable, IPublishedModule } from '../builds';
import { DevelopmentError } from '../error';
import { Located } from '../located';
import { Manifest } from './manifest';
import { References } from './references';
import type { ITypesDocument } from './document';
import type { TypesRequest } from './request';

/**
 * The declaration of a public module of the workspace: the consolidated declaration its bundler's `types` conditional
 * generates (provenance `generated`), as `GET /declarations` serves it, with the cursor of the source log it is
 * consistent with.
 *
 * What it answers instead:
 *
 * - `422 TYPES_UNSUPPORTED` for a style module, whose `exports` target is a stylesheet: it has no declaration.
 * - `404 DECLARATION_PRODUCER_MISSING` when the module's bundler has no `types` conditional, as the esbuild packaging
 *   mode (`local-2026`'s modules) today, naming the bundler: no producer of declarations is implemented for it, which
 *   says nothing about whether its sources are typed.
 * - `404 DECLARATION_NOT_FOUND` when the module is not there, and `422 DECLARATION_INVALID` with the located
 *   diagnostics when it does not check.
 */
export class Generated {
	#delivery: IBuildable;
	#files: Files;
	#located: Located;

	constructor(delivery: IBuildable, files: Files) {
		this.#delivery = delivery;
		this.#files = files;
		this.#located = new Located(files.root, path => files.revision(path));
	}

	/**
	 * @param module The public module of the workspace
	 * @param request The request, whose specifier and importer the document repeats
	 */
	async read(module: IPublishedModule, request: TypesRequest): Promise<{ document: ITypesDocument; cursor: string }> {
		const { name, version, subpath, vspecifier } = module;
		const manifest = module.path ? await Manifest.read(module.path) : void 0;
		const specifier = subpath === '.' ? name : `${name}/${subpath.slice(2)}`;
		if (manifest?.style(subpath)) {
			const message = `"${specifier}" is a style module: its exports target is a stylesheet, which has no type declaration`;
			throw new DevelopmentError('TYPES_UNSUPPORTED', message, 422, { vspecifier });
		}

		const cursor = this.#files.log.cursor;
		const answer = this.#delivery.declaration ? await this.#delivery.declaration({ name, version, subpath }) : void 0;
		if (!answer || answer.failure?.code === 'OUTPUT_NOT_AVAILABLE') throw await this.#missing(module, specifier, manifest);

		const { declaration, failure } = answer;
		if (!declaration) {
			if (['PACKAGE_NOT_FOUND', 'VERSION_MISMATCH', 'MODULE_NOT_FOUND'].includes(failure.code)) {
				throw new DevelopmentError('DECLARATION_NOT_FOUND', failure.message, 404, { vspecifier });
			}
			const diagnostics = (failure.diagnostics ?? []).map(diagnostic => this.#located.of(diagnostic));
			throw new DevelopmentError('DECLARATION_INVALID', failure.message, 422, { vspecifier, diagnostics });
		}

		// The internal modules of the declaration are named after its versioned identity: they are not references
		const own = (one: string) => one === specifier || one.startsWith(`${vspecifier}/~/`) || one.startsWith(`${vspecifier}/`);
		const document: ITypesDocument = {
			protocol: 'beyond-types/1',
			specifier: request.specifier,
			...(request.importer !== void 0 ? { importer: request.importer } : {}),
			provenance: 'generated',
			package: { name, version, provider: module.supplied ? 'toolchain' : 'workspace' },
			vspecifier: declaration.vspecifier,
			form: 'declaration',
			text: declaration.code,
			etag: declaration.hash,
			references: References.of(declaration.code, vspecifier, own)
		};
		return { document, cursor };
	}

	/**
	 * Why a module produces no declaration: its bundler has no producer of one
	 */
	async #missing(module: IPublishedModule, specifier: string, manifest: Manifest | undefined): Promise<DevelopmentError> {
		const { vspecifier, subpath } = module;
		if (!this.#delivery.declaration) {
			return new DevelopmentError('DECLARATION_PRODUCER_MISSING', 'This service produces no declarations', 404, { vspecifier });
		}
		const bundler = await manifest?.bundler(subpath);
		const named = bundler ? `its bundler ("${bundler.name}"${bundler.specifier ? `, ${bundler.specifier}` : ''})` : 'its bundler';
		const message =
			`Module "${specifier}" produces no declaration: ${named} has no "types" conditional, and no producer of declarations ` +
			'is implemented for it. This says nothing about whether its sources are typed';
		return new DevelopmentError('DECLARATION_PRODUCER_MISSING', message, 404, { vspecifier, ...(bundler ? { bundler } : {}) });
	}
}
