import { watch, readdirSync, lstatSync, type Dirent, type FSWatcher, type Stats } from 'fs';
import { join } from 'path';
import type { Root } from './root';

/**
 * A recursive watch of the served root made of one non-recursive watch per visible directory.
 *
 * Node's recursive `fs.watch` is the operating system's own on macOS and Windows. On Linux, Node emulates it
 * (`lib/internal/fs/recursive_watch.js`, Node 20 to 24): every file is watched by its inode, and the watch of a
 * directory only looks for entries it has not seen. A file replaced by a rename — an atomic write, a temporary
 * file renamed over it, as editors, formatters, Git and this service's own File API write — keeps a watch on
 * the inode that was replaced: its first replacement is reported, and nothing that happens to that path
 * afterwards is. A watch of a directory reports its entries by name whatever inode they have, so a replaced
 * file keeps being reported, and Linux needs one watch per directory instead of one per file and directory.
 *
 * Every visible directory is watched when the watch starts and when one appears; the watch of a directory
 * that is gone (removed, or renamed: its watch would go on reporting under the old path) is closed.
 */
export class Directories {
	#root: Root;
	#hint: (path: string) => void;
	#failed: () => void;
	#watchers = new Map<string, FSWatcher>();
	#closed = false;

	/** How many directories are watched, for diagnostics */
	get size() {
		return this.#watchers.size;
	}

	/**
	 * @param hint Receives the visible contract path of every entry a directory reported
	 * @param failed Called when a directory that still exists can no longer be watched
	 */
	constructor(root: Root, hint: (path: string) => void, failed: () => void) {
		this.#root = root;
		this.#hint = hint;
		this.#failed = failed;
	}

	start() {
		this.#add('');
	}

	#absolute(path: string) {
		return path ? join(this.#root.path, ...path.split('/')) : this.#root.path;
	}

	#stat(path: string): Stats | undefined {
		try {
			return lstatSync(this.#absolute(path), { throwIfNoEntry: false });
		} catch {
			return undefined;
		}
	}

	/**
	 * Watch a directory and every visible directory below it. A directory watched before it is filled is read
	 * after its watch exists, so an entry written meanwhile is either reported or found by the hint's examination.
	 */
	#add(directory: string) {
		if (this.#closed || this.#watchers.has(directory)) return;

		let watcher: FSWatcher;
		try {
			watcher = watch(this.#absolute(directory), (_, name) => name && this.#change(directory, name.toString()));
		} catch (error) {
			// Gone between being seen and being watched: its parent reports it. Anything else, such as the
			// limit of watches of the system, leaves changes unobserved, which only a new epoch can say
			if (this.#stat(directory)?.isDirectory()) this.#failed();
			return;
		}
		watcher.on('error', () => this.#lost(directory));
		this.#watchers.set(directory, watcher);

		let entries: Dirent[] = [];
		try {
			entries = readdirSync(this.#absolute(directory), { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const path = directory ? `${directory}/${entry.name}` : entry.name;
			entry.isDirectory() && this.#root.visible(path) && this.#add(path);
		}
	}

	#change(directory: string, name: string) {
		if (this.#closed) return;
		const path = directory ? `${directory}/${name}` : name;
		if (!this.#root.visible(path)) return;

		this.#stat(path)?.isDirectory() ? this.#add(path) : this.#remove(path);
		this.#hint(path);
	}

	/**
	 * Close the watches of a path that is not a directory any more, and of everything below it
	 */
	#remove(path: string) {
		for (const [directory, watcher] of this.#watchers) {
			if (directory !== path && !directory.startsWith(`${path}/`)) continue;
			watcher.close();
			this.#watchers.delete(directory);
		}
	}

	#lost(directory: string) {
		if (this.#closed) return;
		if (!this.#stat(directory)?.isDirectory()) return this.#remove(directory);
		this.#failed();
	}

	close() {
		this.#closed = true;
		this.#watchers.forEach(watcher => watcher.close());
		this.#watchers.clear();
	}
}
