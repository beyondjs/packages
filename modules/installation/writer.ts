import { promises as fs } from 'fs';
import { randomBytes } from 'crypto';
import { basename, dirname, join } from 'path';

/**
 * What writing the documents of an installation did
 */
export interface IWritten {
	// The lock was put in place
	lock: boolean;
	// The projection was put in place
	execution: boolean;
	// Why writing stopped: the file that could not be written and the code of the cause
	failure?: { path: string; code: string };
}

/**
 * Writes the lock and the execution projection of a workspace root.
 *
 * Both go first to temporary files of `.beyond/`, the directory of the projection: the same filesystem as the root,
 * and ignored by version control through the `.gitignore` (`*`) written there when it has none, so neither a temporary
 * file nor the machine-local projection is ever committed. Each is flushed, then put in place with one rename: the lock first,
 * then the projection. A reader finds the previous content of a file or the new one, never a part. A failure before
 * the renames writes nothing; one between them leaves the new lock and the previous projection, which reads as stale.
 * `IWritten` says exactly which.
 */
export class Writer {
	static IGNORE = '*\n';

	#lock: string;
	#projection: string;
	#directory: string;

	/**
	 * @param lock The path of the lock
	 * @param projection The path of the projection, in the `.beyond/` directory of the root
	 */
	constructor(lock: string, projection: string) {
		this.#lock = lock;
		this.#projection = projection;
		this.#directory = dirname(projection);
	}

	/**
	 * @param lock The text of the lock, or undefined when the lock on disk is kept
	 * @param projection The text of the projection
	 */
	async write(lock: string | undefined, projection: string): Promise<IWritten> {
		const written: IWritten = { lock: false, execution: false };
		const staged: { path: string; temporary: string }[] = [];
		const fail = async (path: string, error: any): Promise<IWritten> => {
			await Promise.all(
				staged.map(({ temporary }) => fs.rm(temporary, { force: true }).catch((): void => void 0))
			);
			return { ...written, failure: { path, code: error?.code || 'unknown error' } };
		};

		try {
			await fs.mkdir(this.#directory, { recursive: true });
			await fs.writeFile(join(this.#directory, '.gitignore'), Writer.IGNORE, { flag: 'wx' }).catch(error => {
				if (error?.code !== 'EEXIST') throw error;
			});
		} catch (error) {
			return fail(this.#directory, error);
		}

		const files: [string, string | undefined][] = [
			[this.#lock, lock],
			[this.#projection, projection]
		];
		for (const [path, content] of files) {
			if (content === void 0) continue;
			const temporary = join(this.#directory, `.${basename(path)}.${randomBytes(6).toString('hex')}.tmp`);
			staged.push({ path, temporary });
			try {
				await Writer.#flush(temporary, content);
			} catch (error) {
				return fail(path, error);
			}
		}

		for (const { path, temporary } of staged) {
			try {
				await fs.rename(temporary, path);
			} catch (error) {
				return fail(path, error);
			}
			path === this.#lock ? (written.lock = true) : (written.execution = true);
		}
		return written;
	}

	static async #flush(path: string, content: string): Promise<void> {
		const handle = await fs.open(path, 'w');
		try {
			await handle.writeFile(content, 'utf8');
			await handle.sync();
		} finally {
			await handle.close();
		}
	}
}
