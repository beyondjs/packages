/**
 * Temporary workspaces, so every case of this validation owns the exact package it checks instead of sharing
 * (and editing) the suite testbed. A workspace is a copy of a checked-in fixture under `./fixtures/`, or, for
 * a small invalid or single-purpose input, written from a description in the check itself.
 */
import { cp, mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

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

	#source;

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

	/**
	 * A temporary copy of a checked-in fixture. The checked-in files are never written.
	 *
	 * @param name Identifies the temporary directory, which deliberately contains a space
	 * @param source The fixture, relative to `./fixtures/`
	 */
	static async copy(name, source) {
		const fixture = await Fixture.create(name, {});
		fixture.#source = join(FIXTURES, source);
		await cp(fixture.#source, fixture.#root, { recursive: true });
		return fixture;
	}

	/**
	 * Copies a file or directory of the checked-in fixture over its copy again, which undoes the edits a case
	 * made to it
	 */
	async restore(relative) {
		await cp(join(this.#source, relative), join(this.#root, relative), { recursive: true, force: true });
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
