import type { Files } from './files';
import type { IBuildable } from './builds';
import { DevelopmentError } from './error';
import { Located } from './located';

/**
 * A declaration as the route answers it
 */
export /*bundle*/ interface IDeclarationDocument {
	vspecifier: string;
	hash: string;
	code: string;
	cursor: string;
}

/**
 * The public declarations of the workspace modules, read by an editor that checks the sources of one
 * module against the modules it imports by bare specifier.
 *
 * A declaration is named by the versioned specifier of its module (`@scope/name@1.0.0/subpath`) or by its
 * bare specifier, which this service resolves to the one version the workspace holds. Serving is separate
 * from generating: the `ts` bundler emits the declaration as the `types` conditional of the module, and this
 * object asks the delivery for that output as it is now, with the cursor of the source log it is consistent
 * with. The declarations of installed packages are not served: an editor resolves them from the package.
 */
export /*bundle*/ class Declarations {
	#delivery: IBuildable;
	#files: Files;
	#located: Located;

	constructor(delivery: IBuildable, files: Files) {
		this.#delivery = delivery;
		this.#files = files;
		this.#located = new Located(files.root, path => files.revision(path));
	}

	/**
	 * The request for a specifier, versioned or bare
	 */
	async #request(specifier: string): Promise<{ name: string; version: string; subpath: string }> {
		const versioned = /^(@[^/@]+\/[^/@]+|[^/@]+)@([^/]+)(?:\/(.+))?$/.exec(specifier);
		if (versioned) {
			const [, name, version, subpath] = versioned;
			return { name, version, subpath: subpath ? `./${subpath}` : '.' };
		}

		const published = await this.#delivery.published();
		const found = published.find(module => module.specifier === specifier || `${module.name}${module.subpath.slice(1)}` === specifier);
		if (!found) throw new DevelopmentError('DECLARATION_NOT_FOUND', `"${specifier}" is not a public module of this workspace`, 404);
		return { name: found.name, version: found.version, subpath: found.subpath };
	}

	async read(specifier: string): Promise<IDeclarationDocument> {
		if (!this.#delivery.declaration) throw new DevelopmentError('DECLARATION_NOT_FOUND', 'This service produces no declarations', 404);
		const request = await this.#request(specifier);
		const cursor = this.#files.log.cursor;
		const { declaration, failure } = await this.#delivery.declaration(request);
		if (declaration) return { ...declaration, cursor };

		const missing = ['PACKAGE_NOT_FOUND', 'VERSION_MISMATCH', 'MODULE_NOT_FOUND', 'OUTPUT_NOT_AVAILABLE'].includes(failure.code);
		if (missing) throw new DevelopmentError('DECLARATION_NOT_FOUND', failure.message, 404);
		const diagnostics = (failure.diagnostics ?? []).map(diagnostic => this.#located.of(diagnostic));
		throw new DevelopmentError('DECLARATION_INVALID', failure.message, 422, { diagnostics });
	}
}
