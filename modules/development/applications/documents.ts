import { isAbsolute, posix } from 'path';
import type { Files } from '../files';
import { DevelopmentError } from '../error';
import type { IApplicationsDiagnostic, IApplicationsDocument } from './types';

const plain = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * What one reading of the declaration found
 */
export interface IDeclared {
	document: IApplicationsDocument;

	/**
	 * What is wrong with the declaration as a whole: the branch or the document that owns it
	 */
	diagnostics: IApplicationsDiagnostic[];

	/**
	 * The applications object, when it could be read
	 */
	value?: Record<string, unknown>;

	/**
	 * The text of the owning document, when it exists and is a JSON object
	 */
	text?: string;

	/**
	 * Where the applications are in the owning document: under `applications` of `beyond.json`, or the whole file the
	 * branch names
	 */
	path: string[];

	/**
	 * The files of the root the declaration was read from, as paths of the File API: `beyond.json`, and the file the
	 * branch names when it is inside the root
	 */
	files: string[];

	/**
	 * Why the owning document cannot be written as it is: a malformed document, a branch that is not an object, or one
	 * that names a file outside the root
	 */
	refusal?: IApplicationsDiagnostic;
}

/**
 * The documents the applications are declared in, read through the File API, so that what the catalog says and the
 * revision it names come from the same bytes and a write here conflicts with a write of the same file through the File
 * API. `beyond.json` of the served root declares them in `applications`: inline, or the name of a JSON file relative to
 * it, which is read only when it is inside the root and is not repository internals (`APPLICATIONS_FILE_OUTSIDE`), since
 * the configuration mechanism joins paths and is no containment boundary. Nor is it another document of the workspace
 * or of the service (`APPLICATIONS_FILE_INVALID`): a manifest (`package.json`, `module.json`, `beyond.json`), the lock
 * (`beyond-lock.json`) or anything under `.beyond`, whose fields a write of an application would otherwise replace or
 * remove as if they were applications.
 */
export class Documents {
	static ROOT = 'beyond.json';
	static BRANCH = 'applications';

	/**
	 * The documents whose fields belong to another declaration: never the file of the applications
	 */
	static RESERVED = new Set(['package.json', 'module.json', 'beyond.json', 'beyond-lock.json']);

	/**
	 * The state directory of the service
	 */
	static STATE = '.beyond';

	/**
	 * The size of a declaration document that is read, in bytes
	 */
	static LIMIT = 1024 * 1024;

	#files: Files;

	constructor(files: Files) {
		this.#files = files;
	}

	async read(): Promise<IDeclared> {
		const files = [Documents.ROOT];
		const path = [Documents.BRANCH];
		const root = await this.#read(Documents.ROOT);
		const inline = (exists: boolean, revision?: string): IApplicationsDocument => ({
			path: Documents.ROOT,
			branch: 'inline',
			exists,
			...(revision ? { revision } : {})
		});

		if (root.refused) {
			const diagnostic = Documents.#refused(root.refused, Documents.ROOT);
			return { document: inline(true), diagnostics: [diagnostic], path, files: [], refusal: diagnostic };
		}
		if (!root.exists) return { document: inline(false), diagnostics: [], path, files };

		const parsed = Documents.#parse(Documents.ROOT, root.text, root.large);
		const document = inline(true, root.revision);
		if (parsed.diagnostic) return { document, diagnostics: [parsed.diagnostic], path, files, refusal: parsed.diagnostic };

		const declared = (<Record<string, unknown>>parsed.value)[Documents.BRANCH];
		if (declared === undefined) return { document, diagnostics: [], text: root.text, path, files };
		if (plain(declared)) return { document, diagnostics: [], value: declared, text: root.text, path, files };
		if (typeof declared === 'string') return this.#named(declared, root.revision);

		const diagnostic = Array.isArray(declared) ? Documents.#array(Documents.ROOT) : Documents.#invalid(`"applications" of beyond.json is an object, or the name of a JSON file holding one`);
		return { document, diagnostics: [diagnostic], text: root.text, path, files, refusal: diagnostic };
	}

	/**
	 * A branch that names a file: read when it is inside the root, relative to `beyond.json`
	 */
	async #named(reference: string, revision: string): Promise<IDeclared> {
		const files = [Documents.ROOT];
		const declaring: IApplicationsDocument = { path: Documents.ROOT, branch: 'file', exists: true, revision, reference };
		const refused = (diagnostic: IApplicationsDiagnostic): IDeclared => ({ document: declaring, diagnostics: [diagnostic], path: [], files, refusal: diagnostic });

		const located = Documents.#locate(reference);
		if (located.diagnostic) return refused(located.diagnostic);

		const path = located.path;
		const file = await this.#read(path);
		if (file.refused) return refused(Documents.#refused(file.refused, reference));
		files.push(path);

		const document: IApplicationsDocument = { path, branch: 'file', exists: file.exists, reference, ...(file.revision ? { revision: file.revision } : {}) };
		if (!file.exists) {
			const message = `The applications are declared in "${path}", which does not exist: create it, or declare them in beyond.json`;
			return { document, diagnostics: [{ code: 'APPLICATIONS_FILE_MISSING', message, severity: 'error' }], path: [], files };
		}

		const parsed = Documents.#parse(path, file.text, file.large, true);
		if (parsed.diagnostic) return { document, diagnostics: [parsed.diagnostic], path: [], files, refusal: parsed.diagnostic };
		return { document, diagnostics: [], value: <Record<string, unknown>>parsed.value, text: file.text, path: [], files };
	}

	/**
	 * The path of the File API a reference names, relative to `beyond.json` (the served root), or why it names none
	 */
	static #locate(reference: string): { path?: string; diagnostic?: IApplicationsDiagnostic } {
		if (!reference.trim()) return { diagnostic: Documents.#invalid('"applications" of beyond.json names no file') };
		if (reference.includes('\\')) return { diagnostic: Documents.#invalid(`"${reference}" is not a path of the workspace: name it with forward slashes`) };

		const outside = () => Documents.#outsider(reference);
		if (isAbsolute(reference) || /^[A-Za-z]:/.test(reference)) return { diagnostic: outside() };
		const path = posix.normalize(reference);
		if (path === '..' || path.startsWith('../')) return { diagnostic: outside() };
		if (path === '.' || path.endsWith('/')) return { diagnostic: Documents.#invalid(`"${reference}" names a directory, not a JSON file`) };
		const segments = path.split('/');
		const name = segments.at(-1).toLowerCase();
		if (Documents.RESERVED.has(name)) return { diagnostic: Documents.#reserved(reference, `${name} is a manifest or the lock of the workspace`) };
		if (segments.some(segment => segment.toLowerCase() === Documents.STATE)) return { diagnostic: Documents.#reserved(reference, 'it is the state of the development service') };
		return { path };
	}

	/**
	 * A file the applications cannot be declared in: its fields belong to another declaration
	 */
	static #reserved(reference: string, reason: string): IApplicationsDiagnostic {
		const message = `"applications" of beyond.json names "${reference}", and ${reason}, whose fields would be read and written as applications: declare them in beyond.json or in a JSON file of their own`;
		return { code: 'APPLICATIONS_FILE_INVALID', message, severity: 'error' };
	}

	/**
	 * Reads a file through the File API: its text and revision, that it does not exist, or the refusal of its path
	 */
	async #read(path: string): Promise<{ exists?: boolean; text?: string; revision?: string; large?: boolean; refused?: DevelopmentError }> {
		try {
			const { bytes, revision } = await this.#files.read(path);
			if (bytes.length > Documents.LIMIT) return { exists: true, revision, large: true };
			return { exists: true, revision, text: bytes.toString('utf8') };
		} catch (error) {
			if (!(error instanceof DevelopmentError)) throw error;
			if (error.code === 'FILE_NOT_FOUND') return { exists: false };
			return { refused: error };
		}
	}

	/**
	 * A document's value: a JSON object, or the diagnostic of why it is not one
	 *
	 * @param branch Whether the document is the file a branch names, whose value is the applications object itself
	 */
	static #parse(path: string, text: string, large: boolean, branch = false): { value?: unknown; diagnostic?: IApplicationsDiagnostic } {
		const failed = (reason: string) => ({ diagnostic: <IApplicationsDiagnostic>{ code: 'APPLICATIONS_FILE_INVALID', message: `"${path}" ${reason}`, severity: 'error' } });
		if (large) return failed(`is larger than ${Documents.LIMIT} bytes, which a declaration is not`);

		let value: unknown;
		try {
			value = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
		} catch (error) {
			return failed(`is not valid JSON: ${(<Error>error).message}`);
		}
		if (branch && Array.isArray(value)) return { diagnostic: Documents.#array(path) };
		return plain(value) ? { value } : failed('is not a JSON object');
	}

	static #array(path: string): IApplicationsDiagnostic {
		const message =
			`The applications of "${path}" are a list: they are an object keyed by application identifier, since the items ` +
			'of a list are identified by directory and would be read only in part';
		return { code: 'APPLICATIONS_ARRAY_UNSUPPORTED', message, severity: 'error' };
	}

	static #invalid(message: string): IApplicationsDiagnostic {
		return { code: 'APPLICATIONS_INVALID', message, severity: 'error' };
	}

	static #outsider(reference: string): IApplicationsDiagnostic {
		const message = `"${reference}" is outside the workspace: the applications are declared in beyond.json or in a JSON file of the workspace, named relative to it`;
		return { code: 'APPLICATIONS_FILE_OUTSIDE', message, severity: 'error' };
	}

	/**
	 * A path the File API refused: outside the root through a link, repository internals or the state of the service
	 */
	static #refused(refused: DevelopmentError, reference: string): IApplicationsDiagnostic {
		if (refused.code === 'PATH_INVALID') return Documents.#invalid(`"${reference}" is not a path of the workspace`);
		return Documents.#outsider(reference);
	}
}
