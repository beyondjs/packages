import { DependencyError } from './error.mjs';
import { ManifestText } from './text.mjs';

/**
 * The manifest edits of a plan written through the File API, each file with the revision it was read at, so a write
 * never replaces content it did not read: an editor, an agent or Git that changed the file in between makes it a
 * conflict, and nothing is overwritten.
 *
 * Every file is read and edited before the first one is written. The edit is made on the text as it is now (other
 * fields, order and formatting as they are), and only where the value is still the one the plan was made from (or
 * already the one it writes). A write that does not complete stops the others and is `MANIFEST_CONFLICT`, naming
 * what was written before it.
 */
export class ManifestWrites {
	#files;
	#edits;
	#actor;

	/**
	 * @param {{read(path: string): Promise<{bytes: Buffer, revision: string}>, mutate(mutation: object, actor: object,
	 * bytes: Buffer): Promise<object>}} files The File API
	 * @param {{path: string, group: string, name: string, before: string | null, after: string}[]} edits
	 * @param {{sub: string, kind: string, task?: string}} actor Who the File API announces as the writer
	 */
	constructor(files, edits, actor) {
		this.#files = files;
		this.#edits = edits;
		this.#actor = actor;
	}

	/**
	 * Writes the edits and reports them on a step: the files written of the files to write, the file being written
	 *
	 * @param {import('../operations/step.mjs').Step} step
	 * @returns {Promise<{path: string, revision: string}[]>} What was written
	 */
	async run(step) {
		const paths = [...new Set(this.#edits.map(({ path }) => path))];
		step.begin({ phase: 'write' }).count(0, paths.length, 'files');
		const prepared = [];
		for (const path of paths) prepared.push(await this.#prepare(path));

		const written = [];
		for (const { path, revision, content } of prepared) {
			step.current(path);
			const result = await this.#files.mutate({ operation: 'write', path, expected: revision }, this.#actor, Buffer.from(content, 'utf8'));
			if (result?.outcome !== 'completed') {
				const why = result?.conflict ? 'it changed after it was read' : result?.error?.message ?? result?.outcome;
				const message = `${path} was not written (${why})${written.length ? `; written before it: ${written.map(one => one.path).join(', ')}` : ''}`;
				throw new DependencyError('MANIFEST_CONFLICT', message, { path, outcome: result?.outcome, written });
			}
			written.push({ path, revision: result.revision });
			step.count(written.length, prepared.length, 'files');
		}
		step.done();
		return written;
	}

	/**
	 * Reads a manifest and applies its edits to its text
	 */
	async #prepare(path) {
		let read;
		try {
			read = await this.#files.read(path);
		} catch (error) {
			throw new DependencyError('MANIFEST_CONFLICT', `${path} could not be read: ${error?.message ?? error}`, { path, written: [] });
		}
		const text = new ManifestText(read.bytes.toString('utf8'));
		for (const { group, name, before, after } of this.#edits.filter(edit => edit.path === path)) {
			const now = text.get(group, name) ?? null;
			if (now !== before && now !== after) {
				const message = `${path} declares ${name} ${now ?? '(nothing)'} in ${group} now, not ${before ?? '(nothing)'} as the plan read it`;
				throw new DependencyError('MANIFEST_CONFLICT', message, { path, written: [] });
			}
			text.set(group, name, after);
		}
		return { path, revision: read.revision, content: text.text };
	}
}
