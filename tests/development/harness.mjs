import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

export { step, results } from '../stage-1/harness.mjs';

export const revision = content => `sha256-${createHash('sha256').update(content).digest('hex')}`;
export const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * A temporary served root seeded with files, removed after the case
 */
export class Project {
	#path = realpathSync(mkdtempSync(join(tmpdir(), 'beyond development ')));
	get path() {
		return this.#path;
	}

	constructor(files = {}) {
		for (const [path, content] of Object.entries(files)) this.write(path, content);
	}

	file(path) {
		return join(this.#path, ...path.split('/'));
	}

	/**
	 * Write directly to disk, as an agent shell, Git or another tool does
	 */
	write(path, content) {
		mkdirSync(dirname(this.file(path)), { recursive: true });
		writeFileSync(this.file(path), content);
	}

	remove() {
		rmSync(this.#path, { recursive: true, force: true });
	}
}

/**
 * Collects the events of a log and waits for the ones a case expects
 */
export class Recorder {
	#events = [];
	get events() {
		return this.#events;
	}

	constructor(log) {
		log.subscribe(event => this.#events.push(event));
	}

	/**
	 * @param {(event: object) => boolean} match
	 * @returns {Promise<object>} The first matching event, recorded already or arriving within the timeout
	 */
	async until(match, timeout = 4000) {
		const deadline = Date.now() + timeout;
		for (;;) {
			const found = this.#events.find(match);
			if (found) return found;
			if (Date.now() > deadline) throw new Error(`No matching event; recorded: ${JSON.stringify(this.#events.map(({ type, path, origin }) => [type, path, origin]))}`);
			await wait(25);
		}
	}

	matching(match) {
		return this.#events.filter(match);
	}
}
