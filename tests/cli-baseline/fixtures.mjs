/**
 * Temporary workspaces written from a description, so every case of this validation owns the exact package
 * it checks instead of sharing (and editing) the suite testbed.
 */
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

/**
 * The Beyond configuration every minimal package needs: which bundler compiles the modules that select none,
 * and which public implementation that alias names. `modules` enables the discovery of module manifests.
 */
export const beyond = { modules: '.', bundler: 'ts' };
export const bundlers = { ts: '@beyond-js/packages/bundlers/ts' };

export class Fixture {
	#root;
	get root() {
		return this.#root;
	}

	/**
	 * @param name Identifies the temporary directory, which deliberately contains a space
	 * @param files Relative path → content; objects are written as JSON
	 */
	static async create(name, files) {
		const fixture = new Fixture();
		const created = await mkdtemp(join(tmpdir(), `beyond cli-baseline ${name}-`));
		fixture.#root = await realpath(created);
		await fixture.write(files);
		return fixture;
	}

	async write(files) {
		for (const [file, content] of Object.entries(files)) {
			const target = join(this.#root, file);
			await mkdir(dirname(target), { recursive: true });
			await writeFile(target, typeof content === 'string' ? content : JSON.stringify(content, null, '\t'));
		}
	}

	path(...segments) {
		return join(this.#root, ...segments);
	}

	async destroy() {
		await rm(this.#root, { recursive: true, force: true });
	}
}

/**
 * A package manifest with the Beyond configuration of this validation
 */
export const manifest = (name, values = {}) =>
	Object.assign({ name, version: '1.0.0', private: true, beyond, bundlers }, values);
