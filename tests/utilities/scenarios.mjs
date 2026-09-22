/**
 * The repeated scenarios of the update lifecycle: what a person working in a project does over and over,
 * and what used to stop happening silently when an announcement was lost.
 *
 * Each scenario runs several times in one service, because the behaviour it checks was intermittent: one
 * passing round is not evidence of a repair. Nothing here reads a source file to decide an outcome; every
 * check reads what the service delivers.
 */
import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const UI = { name: '@fixture/ui', version: '0.1.0' };
const WEB = { platform: 'web' };

/**
 * One workspace under a service, and the questions this validation asks of it
 */
export class Scenarios {
	#root;
	#hosted;
	#wait;

	/**
	 * @param {{root: string, hosted: object, wait: number}} options
	 */
	constructor({ root, hosted, wait = 25000 }) {
		this.#root = root;
		this.#hosted = hosted;
		this.#wait = wait;
	}

	#file(...parts) {
		return join(this.#root, ...parts);
	}

	/**
	 * The module as the service delivers it now
	 */
	async #module(subpath) {
		return this.#hosted.module({ ...UI, subpath }, WEB);
	}

	/**
	 * Waits until what the service delivers satisfies the question, which is what tells a rebuild that
	 * landed from a change event that was announced and then lost
	 */
	async #until(subpath, question, what) {
		const deadline = Date.now() + this.#wait;
		let last;
		while (Date.now() < deadline) {
			last = await this.#module(subpath);
			if (question(last)) return last;
			await new Promise(resolve => setTimeout(resolve, 150));
		}
		const state = last?.delivered ? `hash ${last.delivered.hash}` : `failure ${JSON.stringify(last?.failure)}`;
		throw new Error(`${what}: the service still answers ${state} after ${this.#wait} ms`);
	}

	/**
	 * The text of the delivered module, whatever form the compiled code arrives in
	 */
	static code(delivered) {
		return typeof delivered.code === 'function' ? delivered.code() : String(delivered.code ?? '');
	}

	/**
	 * An ordinary edit of a source: the module the service delivers carries it
	 */
	async edit(round) {
		const value = 100 + round;
		const file = this.#file('ui', 'card', 'index.ts');
		const source = await readFile(file, 'utf8');
		const marked = source.replace(/`\$\{title\('Card'\)\} \d+`/, `\`\${title('Card')} ${value}\``);
		assert.notEqual(marked, source, 'the fixture still carries the counter this scenario edits');

		await writeFile(file, marked);
		const { delivered } = await this.#until(
			'./card',
			result => result.delivered && Scenarios.code(result.delivered).includes(`Card')} ${value}`),
			`round ${round}: an ordinary edit`
		);
		return delivered.hash;
	}

	/**
	 * A source that does not compile is reported, and its correction is compiled again: a build that failed
	 * must not stay failed, which is what a lost announcement left behind
	 */
	async recovery(round) {
		const file = this.#file('ui', 'card', 'title.ts');
		const good = await readFile(file, 'utf8');

		await writeFile(file, 'export const title = (text: string): string => `[${text}\n');
		const broken = await this.#until('./card', result => !!result.failure, `round ${round}: a broken source`);
		assert.ok(broken.failure.diagnostics?.length, 'the failure carries diagnostics');

		await writeFile(file, good);
		const restored = await this.#until('./card', result => !!result.delivered, `round ${round}: the correction`);
		return `${broken.failure.code} then ${restored.delivered.hash}`;
	}

	/**
	 * A stylesheet of another package of the workspace is a compile-time dependency: editing it invalidates
	 * the modules that read it
	 */
	async stylesheet(round) {
		const before = await this.#module('./card');
		assert.ok(before.delivered?.styles, 'the card has a stylesheet');

		const file = this.#file('shared', 'palette.scss');
		const source = await readFile(file, 'utf8');
		const colour = `rgb(${20 + round}, 30, 40)`;
		await writeFile(file, source.replace(/rgb\([^)]*\)/, colour));

		const { delivered } = await this.#until(
			'./card',
			result => result.delivered && result.delivered.styles !== before.delivered.styles,
			`round ${round}: a stylesheet of another package`
		);
		return `styles ${before.delivered.styles} → ${delivered.styles}`;
	}

	/**
	 * A module declared after the service started, and one that stops being declared: the workspace is
	 * replaced, its watchers are released and the new ones must be the ones that answer the next edit
	 */
	async manifest(round) {
		const manifest = this.#file('ui', 'extra', 'module.json');
		const declaration = await readFile(manifest, 'utf8');

		await rm(manifest);
		await this.#hosted.refresh();
		const removed = await this.#module('./extra');
		assert.ok(removed.failure, 'the module that is no longer declared is not delivered');

		await writeFile(manifest, declaration);
		await this.#hosted.refresh();
		const added = await this.#module('./extra');
		assert.ok(added.delivered, `the module declared again is delivered: ${JSON.stringify(added.failure)}`);

		// The watchers of the reloaded workspace are the ones that must answer the next edit
		const source = this.#file('ui', 'extra', 'index.ts');
		await writeFile(source, `export const extra = (): string => 'extra ${round}';\n`);
		const { delivered } = await this.#until(
			'./extra',
			result => result.delivered && Scenarios.code(result.delivered).includes(`extra ${round}`),
			`round ${round}: an edit after a manifest reload`
		);
		return `reloaded, ${delivered.hash}`;
	}

	/**
	 * After everything above, the service still answers for every module it declares
	 */
	async usable() {
		const published = await this.#hosted.published();
		const specifiers = published.map(one => one.specifier).sort();

		for (const subpath of ['./card', './extra']) {
			const { delivered, failure } = await this.#module(subpath);
			assert.ok(delivered, `${subpath} is delivered: ${JSON.stringify(failure)}`);
		}
		return specifiers.join(', ');
	}
}
