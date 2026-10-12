import { basename, dirname } from 'path';
import { Config } from '@beyond-js/config/main';
import { WatcherClient } from '@beyond-js/watchers/client';

/**
 * A document of the declaration as the configuration mechanism follows it
 */
interface IFollowed {
	config: Config;
	listener: { destroy(): unknown; off(event: string, listener: (...args: unknown[]) => void): unknown };
	changed: () => void;
	observed: (event: string, file: string) => void;
}

/**
 * Follows the documents of the declaration of applications with the public `Config` of `@beyond-js/config/main`, each
 * watched through the host's watchers service (the service named `watchers`): `beyond.json` and the file its
 * `applications` branch names, which the reader checked is inside the root before it is given here, so the
 * configuration mechanism never reads a file outside it. Whatever writes one of them (the interface through the File
 * API, an editor, an agent, Git), the watcher invalidates the processor of the document, its `change` reaches the
 * catalog, and the catalog reads the declaration again.
 *
 * Each document is a `Config` of its own, with no declared branch. The `Config` installed with Packages (1.0.3) does
 * not pass a change confined to a declared branch on to that branch, does not watch the file a declared branch names,
 * and watches a file only when it is given both a watcher and a listener, so each document is given its own listener
 * of the root's watcher; which file the branch names is decided by the reader, relative to `beyond.json`, as a
 * declared branch would resolve it. The `@beyond-js/file` installed with it (1.0.6) does not parse a corrected file
 * after a malformed one (it reads its own earlier error as the file's), so its processor keeps the value it had and
 * announces no change: the watcher's own event of a followed document is taken as a change too.
 *
 * The watcher of the root is started once, in the background: until it is ready (`BEYOND_APPLICATIONS_WATCH_TIMEOUT`,
 * 30 s, bounds how long a start waits for it before it says so) the catalog follows the File API's events alone, and a
 * readiness that comes later starts following then.
 */
export class Source {
	static VARIABLE = 'BEYOND_APPLICATIONS_WATCH_TIMEOUT';
	static TIMEOUT = 30000;

	#root: string;
	#changed: () => void;
	#timeout: number;
	#watcher: WatcherClient;
	#state: 'idle' | 'starting' | 'watching' | 'failed' | 'stopped' = 'idle';
	#wanted: string[] = [];
	#followed = new Map<string, IFollowed>();
	#timer: ReturnType<typeof setTimeout>;
	#reason: string | undefined;

	/**
	 * Whether a process already said that the watchers service does not follow a declaration: it is said once
	 */
	static #said = false;

	/**
	 * Whether the documents are followed through the watchers service
	 */
	get watching(): boolean {
		return this.#state === 'watching';
	}

	/**
	 * Whether the watchers service follows the documents: `ready`, `starting` (until its watcher is ready, within its
	 * bound) or `unavailable`, with `reason`
	 */
	get state(): 'starting' | 'ready' | 'unavailable' {
		if (this.#state === 'watching') return 'ready';
		return this.#reason ? 'unavailable' : 'starting';
	}

	/**
	 * Why the watchers service does not follow the documents, when it does not
	 */
	get reason(): string | undefined {
		return this.#state === 'watching' ? void 0 : this.#reason;
	}

	/**
	 * The documents followed, by absolute path
	 */
	get followed(): string[] {
		return [...this.#followed.keys()];
	}

	/**
	 * @param root The served root, whose watcher the documents are listened through
	 * @param changed Called when the processor of a followed document changed
	 */
	constructor(root: string, changed: () => void, environment: NodeJS.ProcessEnv = process.env) {
		this.#root = root;
		this.#changed = changed;
		const configured = Number(environment[Source.VARIABLE]);
		this.#timeout = Number.isFinite(configured) && configured > 0 ? configured : Source.TIMEOUT;
	}

	/**
	 * Starts the watcher of the root in the watchers service, once
	 *
	 * @returns Whether the documents are followed through it once it is ready, or `false` when it failed or was not ready
	 * within the bound (a later readiness still starts following)
	 */
	async start(): Promise<boolean> {
		if (this.#state !== 'idle') return this.watching;
		this.#state = 'starting';

		let ready: Promise<boolean>;
		try {
			this.#watcher = new WatcherClient('watchers', { is: 'applications', path: this.#root });
			ready = this.#watcher.start().then(
				() => {
					if (this.#state !== 'starting') return false;
					this.#state = 'watching';
					this.#apply();
					return true;
				},
				(error: Error) => {
					this.#state === 'starting' && (this.#state = 'failed');
					this.#unavailable(error?.message ?? String(error));
					return false;
				}
			);
		} catch (error) {
			this.#state = 'failed';
			this.#unavailable((<Error>error).message);
			return false;
		}

		// The bound keeps no process alive by itself, and ends with the source
		const expired = new Promise<boolean>(resolve => {
			this.#timer = setTimeout(() => resolve(false), this.#timeout);
			this.#timer.unref?.();
		});
		const outcome = await Promise.race([ready, expired]);
		clearTimeout(this.#timer);
		!outcome && this.#state === 'starting' && this.#unavailable(`its watcher of the root was not ready within ${this.#timeout}ms`);
		return outcome;
	}

	/**
	 * Records why the watchers service does not follow the documents, and says it once in the life of the process
	 */
	#unavailable(reason: string) {
		this.#reason = reason;
		if (Source.#said) return;
		Source.#said = true;
		console.warn(`[applications] the watchers service does not follow the declaration of applications (${reason}); the catalog reads it when it is asked, and follows the File API's events unless they are turned off`);
	}

	/**
	 * Follows exactly these documents, by absolute path inside the root: the ones the reader read the declaration from
	 */
	follow(files: string[]): void {
		this.#wanted = [...files];
		this.#state === 'watching' && this.#apply();
	}

	#apply() {
		for (const [file, followed] of [...this.#followed]) !this.#wanted.includes(file) && this.#release(file, followed);
		for (const file of this.#wanted) !this.#followed.has(file) && this.#add(file);
	}

	#add(file: string) {
		const listener = this.#watcher.listeners.create(dirname(file), { filename: basename(file) });
		const config = new Config(dirname(file), {}, { watcher: this.#watcher, listener });
		config.data = basename(file);

		const changed = () => this.#changed();
		const observed = (event: string, path: string) => path === file && this.#changed();
		config.on('change', changed);
		listener.on('all', observed);
		this.#followed.set(file, { config, listener, changed, observed });

		// Processing starts with readiness; a document that cannot be followed leaves the File API's events to the catalog
		config.ready.catch((error: Error): void => console.warn(`[applications] "${basename(file)}" is not followed: ${error?.message}`));
	}

	#release(file: string, { config, listener, changed, observed }: IFollowed) {
		this.#followed.delete(file);
		config.off('change', changed);
		listener.off('all', observed);
		try {
			config.destroy();
		} catch (error) {
			console.warn(`[applications] releasing "${basename(file)}": ${(<Error>error).message}`);
		}
		Promise.resolve()
			.then(() => listener.destroy())
			.catch((): void => undefined);
	}

	/**
	 * Releases the documents, their listeners and the watcher of the root, once
	 */
	destroy(): void {
		if (this.#state === 'stopped') return;
		this.#state = 'stopped';
		this.#reason ??= 'the catalog was stopped';
		clearTimeout(this.#timer);
		for (const [file, followed] of [...this.#followed]) this.#release(file, followed);
		const watcher = this.#watcher;
		watcher &&
			Promise.resolve()
				.then(() => watcher.destroy())
				.catch((): void => undefined);
	}
}
