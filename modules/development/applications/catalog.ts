import { join } from 'path';
import type { Files } from '../files';
import type { IApplicationsCatalog, IApplicationsDiagnostic, IApplicationsDocument, IApplicationsFollowing, ICatalogApplication } from './types';
import { Documents, type IDeclared } from './documents';
import { Validation } from './validation';

/**
 * The catalog of the applications and execution targets of the served workspace, with its generation: the generation
 * grows by one every time the catalog changed (what it lists, its diagnostics or the revision of the document that
 * owns it), so a client tells a newer catalog from an older one.
 */
export class Catalog {
	static PROTOCOL = <const>'beyond-applications/1';

	#generation = 0;
	get generation() {
		return this.#generation;
	}

	#content: { document: IApplicationsDocument; applications: ICatalogApplication[]; diagnostics: IApplicationsDiagnostic[] } = {
		document: { path: Documents.ROOT, branch: 'inline', exists: false },
		applications: [],
		diagnostics: []
	};

	/**
	 * The catalog document, with how the service follows the declaration now
	 */
	document(following: IApplicationsFollowing): IApplicationsCatalog {
		const { document, applications, diagnostics } = this.#content;
		return { protocol: Catalog.PROTOCOL, generation: this.#generation, document, following, applications, diagnostics };
	}

	/**
	 * Makes a catalog current when it differs from the current one
	 *
	 * @returns Whether it changed, and so took the next generation
	 */
	publish(document: IApplicationsDocument, applications: ICatalogApplication[], diagnostics: IApplicationsDiagnostic[]): boolean {
		const next = { document, applications, diagnostics };
		if (JSON.stringify(next) === JSON.stringify(this.#content)) return false;
		this.#content = next;
		this.#generation++;
		return true;
	}
}

/**
 * Brings the catalog up to date with the declaration, one processing at a time.
 *
 * A request starts a processing, or shares the one that will start after the processing in progress, which may have
 * read the files before the change that asked for it: so the processing a request is answered with read the files
 * after the request, and an obsolete processing never replaces a newer one. Each processing reads the declaration
 * through the File API, after delivering the hints its watcher collected, so the File API's own `file.*` event of a
 * change precedes `applications.changed {generation, revision}`, which is appended to the event log whenever the
 * catalog changed, whoever wrote the files.
 */
export class Processing {
	/**
	 * How long a processing asked for by the watcher of a document waits, in milliseconds, so that the changes of one
	 * save and the File API's view of them are taken together
	 */
	static SETTLE = 60;

	#files: Files;
	#documents: Documents;
	#validation = new Validation();
	#catalog = new Catalog();
	#follow: (files: string[]) => void;
	#following: () => IApplicationsFollowing;
	#current: Promise<unknown> = Promise.resolve();
	#next: Promise<IApplicationsCatalog> | undefined;
	#read: string[] = [Documents.ROOT];

	get catalog(): IApplicationsCatalog {
		return this.#catalog.document(this.#following());
	}

	/**
	 * The documents the last processing read, as paths of the File API
	 */
	get documents(): string[] {
		return [...this.#read];
	}

	/**
	 * @param follow Receives the documents of each processing, by absolute path, for the configuration to follow
	 * @param following Says how the service follows the declaration now
	 */
	constructor(files: Files, documents: Documents, follow: (files: string[]) => void, following: () => IApplicationsFollowing) {
		this.#files = files;
		this.#documents = documents;
		this.#follow = follow;
		this.#following = following;
	}

	/**
	 * @param settle Wait `Processing.SETTLE` first, as a processing the watcher of a document asked for does
	 * @returns The catalog of a processing that read the declaration after this request
	 */
	request({ settle = false } = {}): Promise<IApplicationsCatalog> {
		if (this.#next) return this.#next;
		const next = this.#current
			.then(() => settle && new Promise<void>(resolve => void setTimeout(resolve, Processing.SETTLE)))
			.then(() => {
				this.#next = void 0;
				const run = this.#run();
				this.#current = run.catch((): void => undefined);
				return run;
			});
		this.#next = next;
		return next;
	}

	async #run(): Promise<IApplicationsCatalog> {
		await this.#files.observer.flush();
		const declared: IDeclared = await this.#documents.read();
		this.#read = declared.files;
		this.#follow(declared.files.map(path => join(this.#files.root, ...path.split('/'))));

		const applications = declared.value ? this.#validation.applications(declared.value) : [];
		if (this.#catalog.publish(declared.document, applications, declared.diagnostics)) {
			const { generation } = this.#catalog;
			this.#files.log.append('applications.changed', { generation, revision: declared.document.revision ?? null });
		}
		return this.catalog;
	}
}
