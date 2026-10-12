import type { Files } from '../files';
import type { IActor } from '../mutations';
import { DevelopmentError } from '../error';
import { Revision } from '../revision';
import { Sequence } from '../sequence';
import type { IApplicationsCatalog } from './types';
import type { Documents, IDeclared } from './documents';
import type { Processing } from './catalog';
import { JsonText } from './json/text';
import { Style } from './json/style';
import { Targets } from './targets';
import { Validation } from './validation';

const plain = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);

/**
 * What a write answers: `completed` with the revision it wrote and the catalog that includes it, or `conflict` with the
 * revision of the owning document now (`null` when it does not exist) and the current catalog
 */
export interface IWritten {
	outcome: 'completed' | 'conflict';
	revision: string | null;
	catalog: IApplicationsCatalog;
}

/**
 * What a write states about the owning document: the revision its writer read (`If-Match`), or that the application
 * does not exist yet (`If-None-Match: *`), which creates the document when it does not exist either
 */
export interface ICondition {
	expected?: string;
	absent?: boolean;
}

/**
 * Writes one application of the declaration through the File API's mutation, with the revision of the owning
 * document as its precondition, so a write here and a write of the same file through the File API conflict properly.
 *
 * Only the application written changes: the branch keeps its organization (inline stays inline, a file stays a file),
 * and every other character of the document keeps how it was written ([JsonText](./json/text.ts)). A replacement
 * states the application's known fields; fields this Core does not know are kept from the declaration unless the
 * replacement names them. A malformed owning document, a branch that is a list or not an object, and one that names a
 * file outside the root are not rewritten. Writes run one at a time.
 */
export class Writer {
	static REFUSED = new Set(['APPLICATIONS_FILE_INVALID', 'APPLICATIONS_ARRAY_UNSUPPORTED', 'APPLICATIONS_FILE_OUTSIDE', 'APPLICATIONS_INVALID']);

	#files: Files;
	#documents: Documents;
	#processing: Processing;
	#validation = new Validation();
	#sequence = new Sequence();

	constructor(files: Files, documents: Documents, processing: Processing) {
		this.#files = files;
		this.#documents = documents;
		this.#processing = processing;
	}

	/**
	 * Creates or replaces one application
	 *
	 * @throws DevelopmentError `APPLICATION_INVALID` (422) with the diagnostics, or the code of a declaration that is
	 * not rewritten (422)
	 */
	put(id: string, value: unknown, condition: ICondition, actor?: IActor): Promise<IWritten> {
		const application = this.#validation.application(id, value);
		if (Validation.failed(application)) {
			const diagnostics = [
				...application.diagnostics,
				...application.targets.flatMap(({ id: target, diagnostics }) => diagnostics.map(diagnostic => ({ ...diagnostic, target })))
			];
			throw new DevelopmentError('APPLICATION_INVALID', `The application "${id}" is not valid`, 422, { diagnostics });
		}

		return this.#sequence.run(async () => {
			const declared = await this.#documents.read();
			Writer.#writable(declared);
			const current = declared.document.revision ?? Revision.ABSENT;
			const exists = !!declared.value && own(declared.value, id);
			if (condition.expected !== undefined && condition.expected !== current) return this.#conflict(current);
			if (condition.absent && exists) return this.#conflict(current);

			const kept = this.#carry(declared.value?.[id], <Record<string, unknown>>value);
			return this.#write(declared, current, Writer.#text(declared, id, kept), actor);
		});
	}

	/**
	 * Removes one application, which must exist
	 *
	 * @throws DevelopmentError `APPLICATION_NOT_FOUND` (404), or the code of a declaration that is not rewritten (422)
	 */
	remove(id: string, expected: string, actor?: IActor): Promise<IWritten> {
		return this.#sequence.run(async () => {
			const declared = await this.#documents.read();
			Writer.#writable(declared);
			const current = declared.document.revision ?? Revision.ABSENT;
			if (expected !== current) return this.#conflict(current);
			if (!declared.value || !own(declared.value, id)) {
				throw new DevelopmentError('APPLICATION_NOT_FOUND', `The workspace declares no application "${id}"`, 404);
			}

			const text = new JsonText(declared.text);
			text.remove([...declared.path, id]);
			return this.#write(declared, current, text.text, actor);
		});
	}

	static #writable({ refusal, diagnostics }: IDeclared) {
		if (!refusal || !Writer.REFUSED.has(refusal.code)) return;
		throw new DevelopmentError(refusal.code, `${refusal.message}; it is not rewritten until it is corrected`, 422, { diagnostics });
	}

	/**
	 * The owning document with the application: edited in place, or written anew when it does not exist
	 */
	static #text(declared: IDeclared, id: string, value: Record<string, unknown>): string {
		const path = [...declared.path, id];
		if (!declared.document.exists) return Style.document(path.reduceRight<unknown>((inner, key) => ({ [key]: inner }), value));
		const text = new JsonText(declared.text);
		text.update(path, value);
		return text.text;
	}

	/**
	 * The replacement, with the fields this Core does not know that the declaration has and the replacement does not
	 * name, in the application and in each of its targets the replacement keeps
	 */
	#carry(current: unknown, value: Record<string, unknown>): Record<string, unknown> {
		if (!plain(current)) return value;
		const kept = (before: Record<string, unknown>, after: Record<string, unknown>, known: Set<string>) => {
			const result = { ...after };
			Object.entries(before).forEach(([field, one]) => !known.has(field) && !own(after, field) && (result[field] = one));
			return result;
		};

		const result = kept(current, value, Validation.FIELDS);
		const { targets: before } = current;
		const { targets: after } = value;
		if (!plain(before) || !plain(after)) return result;
		const targets = { ...after };
		Object.entries(after).forEach(([id, target]) => plain(before[id]) && plain(target) && (targets[id] = kept(<Record<string, unknown>>before[id], target, Targets.FIELDS)));
		return { ...result, targets };
	}

	async #write(declared: IDeclared, expected: string, text: string, actor?: IActor): Promise<IWritten> {
		const { path } = declared.document;
		const result = await this.#files.mutate({ operation: 'write', path, expected }, actor, Buffer.from(text, 'utf8'));
		if (result.outcome === 'conflict') return this.#conflict(result.conflict.current);
		if (result.outcome !== 'completed') {
			const { code = 'WRITE_FAILED', message = 'the write did not complete' } = result.error ?? {};
			throw new DevelopmentError(code, `"${path}" was not written: ${message}`, 500);
		}
		return { outcome: 'completed', revision: result.revision, catalog: await this.#processing.request() };
	}

	async #conflict(current: string): Promise<IWritten> {
		const catalog = await this.#processing.request();
		return { outcome: 'conflict', revision: current === Revision.ABSENT ? null : current, catalog };
	}
}
