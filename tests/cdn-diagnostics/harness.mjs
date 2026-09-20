/**
 * What the checks of the semantic diagnostics are written against: how a step is run and reported, and the
 * temporary packages they check.
 */
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * The outcome of every step that ran, in order
 */
export const results = [];

/**
 * Runs one step and reports it. A failure does not interrupt the run, so one execution reports the state of
 * every checked behavior instead of only the first defect.
 *
 * @param name What the step establishes
 * @param fn The checks, which may return a short note describing what was observed
 */
export const step = async (name, fn) => {
	try {
		const notes = await fn();
		results.push({ name, ok: true });
		console.log(`PASS ${name}${notes ? ` — ${notes}` : ''}`);
	} catch (error) {
		results.push({ name, ok: false });
		console.log(`FAIL ${name}\n${error.stack}`);
	}
};

/**
 * The zero-based position of a text in a source, as a diagnostic reports it
 */
export const position = (source, text, offset = 0) => {
	const index = source.indexOf(text);
	if (index < 0) throw new Error(`"${text}" is not in the source`);

	const lines = source.slice(0, index + offset).split('\n');
	return { line: lines.length - 1, character: lines.at(-1).length };
};

/**
 * A temporary directory holding the packages one run checks. Nothing of the repository is edited.
 */
export class Fixture {
	#root;
	get root() {
		return this.#root;
	}

	#files;

	/**
	 * Every result a check returned, kept to verify that none of them describes the host
	 */
	#observed = [];
	get observed() {
		return this.#observed;
	}

	constructor(files) {
		this.#files = files;
	}

	async create() {
		this.#root = await mkdtemp(join(tmpdir(), 'beyond-cdn-diagnostics-'));
		for (const [relative, content] of Object.entries(this.#files)) {
			const file = join(this.#root, relative);
			await mkdir(dirname(file), { recursive: true });
			await writeFile(file, typeof content === 'string' ? content : JSON.stringify(content, null, '\t'));
		}
		return this;
	}

	/**
	 * The absolute location of a file or directory of the fixture
	 */
	path(relative) {
		return join(this.#root, relative);
	}

	/**
	 * The content a file of the fixture was written with
	 */
	source(relative) {
		return this.#files[relative];
	}

	/**
	 * The description of a public module of the application package of the fixture
	 */
	module(name, extra) {
		const root = this.path('app');
		return Object.assign(
			{ package: '@fixture/app', version: '1.0.0', root, subpath: `./${name}`, entry: `${name}/index.ts` },
			extra
		);
	}

	/**
	 * Keeps a result for the verification of what results disclose, and returns it
	 */
	observe(result) {
		this.#observed.push(result);
		return result;
	}

	async destroy() {
		await rm(this.#root, { recursive: true, force: true });
	}
}
