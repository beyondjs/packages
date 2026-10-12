import { promises as fs } from 'fs';
import type { IBuildable } from '../builds';
import type { Instances } from '../preview/instances';
import { DevelopmentError } from '../error';
import { Confined } from './confined';
import type { IContext } from './context';
import type { ITypesDocument } from './document';
import { Entry } from './entry';
import { Installations, type ICandidate } from './installations';
import { Manifest } from './manifest';
import { References } from './references';
import type { TypesRequest } from './request';

/**
 * The declaration of a package the workspace does not contain, as the type check of its importer reads it.
 *
 * The packages tried are the ones the importer reaches, in the order a type check tries them: through the edges of
 * the installed graph when the workspace has one (the package, then the `@types` package the importer declares),
 * else as installed for the importer's directory, then by the toolchain (`Installations`). In each, the file is the
 * one `Entry` finds and `Confined` reads. Provenance is `package` or `types-package`.
 *
 * What it answers instead: `403 TYPES_ACCESS` for a package that names a file outside itself, `422 TYPES_UNSUPPORTED`
 * for a package installed from Git or an archive address (it has no registry identity) or a Node builtin, and `404
 * DECLARATION_NOT_FOUND` with what each package tried lacks.
 */
export class Installed {
	#delivery: IBuildable;
	#instances: Instances | undefined;
	#installations: Installations;

	constructor(delivery: IBuildable, instances: Instances | undefined, installations: Installations) {
		this.#delivery = delivery;
		this.#instances = instances;
		this.#installations = installations;
	}

	/**
	 * The packages an installed graph gives an importer for a name: the node its edge binds and the node of the
	 * `@types` package it declares; a member is the workspace's
	 */
	#bound(context: IContext, name: string, reasons: string[]): ICandidate[] {
		const instances = this.#instances;
		const names: [string, ICandidate['provenance']][] = [[name, name.startsWith('@types/') ? 'types-package' : 'package']];
		const types = Installations.types(name);
		types && names.push([types, 'types-package']);

		const found: ICandidate[] = [];
		for (const [one, provenance] of names) {
			const { node, error } = instances.bind(context.key, one, context.chain);
			if (node && !instances.member(node)) found.push({ name: one, root: node.location, provenance, provider: 'store', node });
			// What the importer does not reach of the package itself is why there is nothing to read
			one === name && error && reasons.push(`${context.label} does not reach "${name}": ${error.message}`);
		}
		return found;
	}

	/**
	 * Why a package has no registry identity: installed from Git or an archive address
	 */
	async #unsupported(candidate: ICandidate, manifest: Manifest): Promise<string | undefined> {
		const { name, version } = candidate.node ?? { name: manifest.name, version: manifest.version };
		if (!name || !version) return;
		const origin = candidate.node ? await this.#instances.origin(candidate.node) : await this.#delivery.origin?.(name, version);
		return origin && !origin.registry ? origin.reason : void 0;
	}

	/**
	 * @throws DevelopmentError `TYPES_ACCESS`, `TYPES_UNSUPPORTED`, `DECLARATION_NOT_FOUND`, `DECLARATION_INVALID`
	 */
	async read(request: TypesRequest, context: IContext): Promise<ITypesDocument> {
		const { name, subpath } = request.specified;
		const reasons: string[] = [];
		const candidates = this.#instances ? this.#bound(context, name, reasons) : await this.#installations.candidates(name, context.directory);

		for (const candidate of candidates) {
			const root = await fs.realpath(candidate.root).catch((): undefined => void 0);
			const manifest = root && (await Manifest.read(root));
			const label = `"${candidate.name}"${manifest?.version ? ` ${manifest.version}` : ''}`;
			if (!manifest) {
				reasons.push(`${label} has no package.json that can be read`);
				continue;
			}

			const entry = await new Entry(manifest).resolve(subpath);
			if (entry.escape) {
				const message = `${label} names "${entry.escape}" for "${request.specifier}", which is outside the package: only files inside the package are read`;
				throw new DevelopmentError('TYPES_ACCESS', message, 403);
			}
			if (!entry.file) {
				reasons.push(`${label}: ${entry.reason}`);
				continue;
			}

			const unsupported = await this.#unsupported(candidate, manifest);
			if (unsupported) throw new DevelopmentError('TYPES_UNSUPPORTED', `${unsupported}: this route reads the declarations of registry and workspace packages`, 422);

			const { text, etag, path } = await new Confined(manifest.directory).read(entry.file, label);
			const identity = { name: manifest.name ?? candidate.name, ...(manifest.version ? { version: manifest.version } : {}), provider: candidate.provider };
			return {
				protocol: 'beyond-types/1',
				specifier: request.specifier,
				...(request.importer !== void 0 ? { importer: request.importer } : {}),
				provenance: candidate.provenance,
				package: identity,
				file: path,
				form: Entry.declaration(path) ? 'declaration' : 'source',
				text,
				etag,
				references: References.of(text, `${context.label} > ${candidate.name}`)
			};
		}

		if (request.builtin) {
			throw new DevelopmentError('TYPES_UNSUPPORTED', `"${request.specifier}" is a builtin module of Node, which @types/node declares ambiently: this route reads the declarations of packages`, 422);
		}
		const missing = candidates.length ? `no package a type check of ${context.label} reaches declares it` : `"${name}" is not installed for ${context.label}`;
		const message = `There is no declaration of "${request.specifier}": ${missing}${reasons.length ? ` (${reasons.join('; ')})` : ''}`;
		throw new DevelopmentError('DECLARATION_NOT_FOUND', message, 404, { reasons });
	}
}
