import type { ILockDocument } from './types';
import { promises as fs } from 'fs';
import { join } from 'path';
import { Canonical } from '@beyond-js/packages/resolution';
import { Execution } from '@beyond-js/packages/execution';
import { LockShape } from './shape';

/**
 * `beyond-lock.json` at a workspace root. Whatever it holds is offered to the resolution as version preferences (a
 * `beyond-lock/2` document, sound or not, or the entries of the previous format); only a sound `beyond-lock/2`
 * document (`LockShape`) whose inputs are the current ones is the graph itself, and the installation is then frozen.
 * It is rewritten unless what it holds is sound and has the digest of the new document.
 */
export class LockFile {
	static NAME = Execution.LOCK;

	#path: string;
	get path() {
		return this.#path;
	}

	#data?: any;
	/**
	 * The parsed content, in any format: what the resolution reads as preferences
	 */
	get data() {
		return this.#data;
	}

	#document?: ILockDocument;
	/**
	 * The content when it is a sound `beyond-lock/2` document
	 */
	get document() {
		return this.#document;
	}

	#problem?: string;
	/**
	 * Why a file that exists could not be read or is not a sound `beyond-lock/2` document
	 */
	get problem() {
		return this.#problem;
	}

	/**
	 * The digest of what the file holds, when it is a sound `beyond-lock/2` document
	 */
	get digest(): string | undefined {
		return this.#document?.digest;
	}

	constructor(root: string) {
		this.#path = join(root, LockFile.NAME);
	}

	async read(): Promise<void> {
		this.#data = this.#document = this.#problem = void 0;

		let text: string;
		try {
			text = await fs.readFile(this.#path, 'utf8');
		} catch (error) {
			if (error?.code !== 'ENOENT') this.#problem = `it could not be read (${error?.code || 'unknown error'})`;
			return;
		}
		try {
			this.#data = JSON.parse(text);
		} catch {
			this.#problem = 'it is not valid JSON';
			return;
		}

		if (this.#data?.protocol !== 'beyond-lock/2') return;
		const problem = LockShape.check(this.#data);
		problem ? (this.#problem = problem) : (this.#document = this.#data);
	}

	/**
	 * Whether the lock is the graph of these inputs: a sound `beyond-lock/2` document recorded from equal inputs
	 * for the same members (the root importer `.` aside, which the root manifest declares)
	 *
	 * @param ids The ids of the members the workspace declares
	 */
	covers(inputs: object, ids: string[]): boolean {
		const document = this.#document;
		if (!document || Canonical.text(document.inputs) !== Canonical.text(inputs ?? {})) return false;

		const locked = Object.keys(document.members);
		const declared = new Set(ids);
		return ids.every(id => locked.includes(id)) && locked.every(id => declared.has(id) || id === '.');
	}

	/**
	 * Whether the file must be written to hold a document: unless what it holds is sound and has its digest. A file
	 * whose content differs only in what a lock does not record (an added member, a reordered list) is rewritten.
	 */
	differs(document: ILockDocument): boolean {
		return this.#document?.digest !== document.digest;
	}

	/**
	 * Whether the content can still be offered to the resolution as version preferences
	 */
	get readable(): boolean {
		return this.#data !== void 0;
	}
}
