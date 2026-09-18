import { promises as fs } from 'fs';
import { dirname } from 'path';
import type { Root } from './root';
import type { Entries } from './entries';
import type { Log } from './log';
import { Revision } from './revision';
import { DevelopmentError } from './error';

export /*bundle*/ interface IMutation {
	operation: 'write' | 'delete' | 'rename';
	path: string;
	expected: string;
	to?: string;
	content?: string;
	encoding?: 'utf8' | 'base64';
}

export /*bundle*/ interface IMutationResult {
	outcome: 'completed' | 'conflict' | 'failed' | 'skipped';
	path: string;
	revision?: string;
	cursor?: string;
	conflict?: { expected: string; current: string; target?: string };
	error?: { code: string; message: string };
}

export /*bundle*/ interface IActor {
	sub: string;
	kind: string;
	task?: string;
}

/**
 * Source mutations. Every mutation states what the writer believes is on disk, and the belief is compared
 * with the bytes on disk at the mutation boundary: agents, Git and other tools write without passing through
 * this API, so neither an index nor a lock can stand in for that comparison.
 */
export class Mutations {
	static LIMIT = 5 * 1024 * 1024;

	#root: Root;
	#entries: Entries;
	#log: Log;

	constructor(root: Root, entries: Entries, log: Log) {
		this.#root = root;
		this.#entries = entries;
		this.#log = log;
	}

	async #current(file: string): Promise<{ bytes?: Buffer; revision: string }> {
		const bytes = await fs.readFile(file).catch((error: NodeJS.ErrnoException) => {
			if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return undefined;
			throw error;
		});
		return { bytes, revision: bytes ? Revision.of(bytes) : Revision.ABSENT };
	}

	#bytes(mutation: IMutation): Buffer {
		if (typeof mutation.content !== 'string') throw new DevelopmentError('MUTATION_INVALID', 'A write needs its content', 400);
		const bytes = Buffer.from(mutation.content, mutation.encoding === 'base64' ? 'base64' : 'utf8');
		if (bytes.length > Mutations.LIMIT) throw new DevelopmentError('FILE_TOO_LARGE', `Files are limited to ${Mutations.LIMIT} bytes`, 413);
		return bytes;
	}

	/**
	 * Apply one mutation. Invalid requests throw; everything about the state of the file is a result.
	 *
	 * @param bytes The content of a write when the caller already holds it as bytes
	 */
	async apply(mutation: IMutation, actor?: IActor, data: Record<string, unknown> = {}, bytes?: Buffer): Promise<IMutationResult> {
		const { operation, path, expected } = mutation;
		const file = this.#root.resolve(path);
		if (expected !== Revision.ABSENT && !Revision.valid(expected)) {
			throw new DevelopmentError('PRECONDITION_REQUIRED', 'State the expected revision, or that the path is absent', 428);
		}
		if (operation !== 'write' && expected === Revision.ABSENT) {
			throw new DevelopmentError('MUTATION_INVALID', `A ${operation} needs the revision it removes`, 400);
		}
		if (operation === 'write') bytes ??= this.#bytes(mutation);
		const target = operation === 'rename' ? this.#root.resolve(mutation.to) : undefined;

		const current = await this.#current(file);
		if (current.revision !== expected) return { outcome: 'conflict', path, conflict: { expected, current: current.revision } };
		const announce = { ...(actor ? { actor } : {}), ...data };

		try {
			if (operation === 'write') {
				await fs.mkdir(dirname(file), { recursive: true });
				const temporary = this.#root.temporary(file);
				await fs.writeFile(temporary, bytes);
				await fs.rename(temporary, file);
				this.#entries.record(path, bytes, announce);
				return { outcome: 'completed', path, revision: Revision.of(bytes), cursor: this.#log.cursor };
			}
			if (operation === 'delete') {
				await fs.unlink(file);
				this.#entries.record(path, undefined, announce);
				return { outcome: 'completed', path, cursor: this.#log.cursor };
			}

			const destination = await this.#current(target);
			if (destination.bytes) {
				return { outcome: 'conflict', path, conflict: { expected, current: current.revision, target: mutation.to } };
			}
			await fs.mkdir(dirname(target), { recursive: true });
			// `link` fails when the destination appeared in the meantime, which `rename` would overwrite
			await fs.link(file, target);
			await fs.unlink(file);
			this.#entries.move(path, mutation.to);
			const revision = current.revision;
			this.#log.append('file.renamed', { path: mutation.to, from: path, revision, origin: 'api', ...announce });
			return { outcome: 'completed', path: mutation.to, revision, cursor: this.#log.cursor };
		} catch (error) {
			return { outcome: 'failed', path, error: { code: (error as NodeJS.ErrnoException).code ?? 'WRITE_FAILED', message: (error as Error).message } };
		}
	}
}
