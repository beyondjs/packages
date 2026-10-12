import type { Application } from 'express';
import type { Access } from '../access';
import type { IBuildable } from '../builds';
import type { Files } from '../files';
import type { IDevelopmentEvent } from '../log';
import type { IActor } from '../mutations';
import type { Preview } from '../preview';
import type { Selection } from '../selection';
import type { IApplicationsCatalog, IApplicationsFollowing, IResolvedTarget } from './types';
import { ApplicationsRoutes } from '../http/applications';
import { Documents } from './documents';
import { Processing } from './catalog';
import { Resolution } from './resolution';
import { Source } from './source';
import { Writer, type ICondition, type IWritten } from './writer';

/**
 * What the catalog of applications works with: the served root, the File API (revisions, mutations and the event
 * log), the delivery, the preview and the selection, and the access guard of the development routes
 */
export interface IApplicationsSpecs {
	root: string;
	files: Files;
	delivery: IBuildable;
	preview: Preview;
	selection: Selection;
	access: Access;
}

/**
 * The applications and execution targets of the served workspace (`beyond-applications/1`), declared in the
 * `applications` branch of its `beyond.json`, inline or in a JSON file of the workspace it names: the catalog
 * (`GET /applications`), the resolution of a target (`GET /applications/:application/targets/:target`, `resolve()`),
 * the writes of one application (`PUT` and `DELETE /applications/:application`) through the File API, and
 * `applications.changed {generation, revision}` on the event log whenever the catalog changed, whoever wrote the
 * declaration. See the suite's `docs/products/packages/developer-journey.md` and [the guide](../../../docs/applications.md).
 *
 * The declaration is followed through the watchers service ([Source](./source.ts)) and through the File API's own
 * events of the documents it is read from; both ask for the same processing ([Processing](./catalog.ts)), which reads
 * the documents through the File API. `BEYOND_APPLICATIONS_FOLLOW=watchers` follows it through the watchers service
 * alone, which is how a validation shows that path on its own.
 */
export class Applications {
	static VARIABLE = 'BEYOND_APPLICATIONS_FOLLOW';

	#files: Files;
	#processing: Processing;
	#source: Source;
	#writer: Writer;
	#resolution: Resolution;
	#routes: ApplicationsRoutes;
	#unsubscribe?: () => void;

	/**
	 * Whether the File API's events of the documents are followed: unless they are turned off, until the File API's own
	 * watcher fails, after which it announces nothing more (a `resync` with the reason `WATCHER`)
	 */
	#events: boolean;

	constructor({ files, delivery, preview, selection, access }: IApplicationsSpecs, environment: NodeJS.ProcessEnv = process.env) {
		this.#events = environment[Applications.VARIABLE] !== 'watchers';
		const documents = new Documents(files);
		this.#files = files;
		this.#source = new Source(files.root, () => this.#request(true));
		this.#processing = new Processing(files, documents, paths => this.#source.follow(paths), () => this.#following());
		this.#writer = new Writer(files, documents, this.#processing);
		this.#resolution = new Resolution(delivery, preview, selection);

		const service = {
			refresh: () => this.refresh(),
			resolve: (application: string, target: string) => this.resolve(application, target),
			put: (id: string, value: unknown, condition: ICondition, actor?: IActor) => this.#writer.put(id, value, condition, actor),
			remove: (id: string, expected: string, actor?: IActor) => this.#writer.remove(id, expected, actor)
		};
		this.#routes = new ApplicationsRoutes(service, access);
	}

	/**
	 * Reads the declaration and starts following it: through the File API's events at once, and through the watchers
	 * service once the watcher of the root is ready, which the start does not wait for. A declaration that cannot be
	 * read is a catalog with diagnostics, never a failed start.
	 */
	async start(): Promise<void> {
		this.#events && (this.#unsubscribe = this.#files.log.subscribe(event => this.#observe(event)));
		await this.#processing.request().catch(error => console.warn(`[applications] the declaration was not read: ${error?.message}`));
		void this.#source.start();
	}

	/**
	 * A change of a document the declaration was read from, from any writer, or a lost continuity of the File API
	 */
	#observe({ type, path, from, reason }: IDevelopmentEvent) {
		if (type === 'resync') {
			reason === 'WATCHER' && (this.#events = false);
			return this.#request();
		}
		if (!type.startsWith('file.')) return;
		const documents = this.#processing.documents;
		[path, from].some(one => typeof one === 'string' && documents.includes(one)) && this.#request();
	}

	/**
	 * How the service follows the declaration now: live when the watchers service or the File API's events reach it
	 */
	#following(): IApplicationsFollowing {
		const { state: watchers, reason } = this.#source;
		const events = this.#events;
		return { live: watchers === 'ready' || events, watchers, events, ...(reason ? { reason } : {}) };
	}

	#request(settle = false) {
		this.#processing.request({ settle }).catch(error => console.warn(`[applications] the declaration was not read: ${error?.message}`));
	}

	setup(app: Application): void {
		this.#routes.setup(app);
	}

	/**
	 * The current catalog document, as the last processing left it
	 */
	catalog(): IApplicationsCatalog {
		return this.#processing.catalog;
	}

	/**
	 * The catalog after a processing that read the declaration after this call
	 */
	refresh(): Promise<IApplicationsCatalog> {
		return this.#processing.request();
	}

	/**
	 * A target resolved against the declaration as it is now: what the launch of an execution target starts from
	 *
	 * @throws DevelopmentError `APPLICATION_NOT_FOUND` or `TARGET_NOT_FOUND` (404)
	 */
	async resolve(application: string, target: string): Promise<IResolvedTarget> {
		return this.#resolution.resolve(await this.#processing.request(), application, target);
	}

	/**
	 * The writes of one application through the File API
	 */
	get writer(): Writer {
		return this.#writer;
	}

	destroy(): void {
		this.#unsubscribe?.();
		this.#unsubscribe = void 0;
		this.#source.destroy();
	}
}
