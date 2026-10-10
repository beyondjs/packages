import { watch } from 'fs';
import type { Root } from './root';
import { Directories } from './directories';

/**
 * Hints that something under the root changed on disk, from the operating system's recursive watcher where
 * it has one (macOS, Windows) and from one watch per directory elsewhere ([Directories](./directories.ts)):
 * Node's emulation of a recursive watch on Linux stops reporting a file once a rename has replaced it.
 * `BEYOND_DEVELOPMENT_WATCH=directories` selects the watch per directory on any platform.
 *
 * A hint carries no truth: the receiver compares the named path with disk. Hints can be lost, so polling and
 * manual refresh scan the root instead of trusting this object, and a watcher failure is reported so that the
 * service starts a new epoch. Compilation keeps its own invalidation through the watchers service; this
 * observer only feeds the source tree that clients see.
 */
export class Observer {
	#root: Root;
	#watcher: { close(): void };
	#pending = new Set<string>();
	#timer: ReturnType<typeof setTimeout>;
	#paused = false;
	#hint: (paths: string[]) => Promise<unknown>;
	#failed: () => void;

	/**
	 * @param hint Receives the visible paths that may have changed, coalesced over a short window
	 * @param failed Called once when the watcher can no longer be trusted
	 */
	constructor(root: Root, hint: (paths: string[]) => Promise<unknown>, failed: () => void) {
		this.#root = root;
		this.#hint = hint;
		this.#failed = failed;
	}

	/**
	 * Platforms where Node's recursive watch is the operating system's own
	 */
	static NATIVE = new Set(['darwin', 'win32']);

	start() {
		const failed = () => {
			this.stop();
			this.#failed();
		};
		const native = Observer.NATIVE.has(process.platform) && process.env.BEYOND_DEVELOPMENT_WATCH !== 'directories';
		if (!native) {
			const directories = new Directories(this.#root, path => this.#collect(path), failed);
			this.#watcher = directories;
			return directories.start();
		}

		const watcher = watch(this.#root.path, { recursive: true }, (_, name) => {
			name && this.#collect(name.toString().split('\\').join('/'));
		});
		watcher.on('error', failed);
		this.#watcher = watcher;
	}

	#collect(path: string) {
		if (this.#paused || !this.#root.visible(path)) return;
		this.#pending.add(path);
		this.#timer ??= setTimeout(() => void this.flush(), 40);
	}

	/**
	 * Deliver the collected hints now
	 */
	async flush() {
		clearTimeout(this.#timer);
		this.#timer = undefined;
		const paths = [...this.#pending];
		this.#pending.clear();
		paths.length && (await this.#hint(paths));
	}

	/**
	 * Stop collecting hints, as a watcher that silently loses events would. For validation of the scan path.
	 */
	pause() {
		this.#paused = true;
		this.#pending.clear();
	}

	resume() {
		this.#paused = false;
	}

	stop() {
		clearTimeout(this.#timer);
		this.#watcher?.close();
		this.#watcher = undefined;
	}
}
