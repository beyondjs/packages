/**
 * The harness of `sources.test.mjs`: the releases of `fixtures/sources/registry` published by an in-process registry, a
 * copy of `fixtures/sources/workspace` installed from it into a temporary store (`Installation`, as `beyond install`
 * installs), and the Packages workspace and delivery the development service builds from the members of the copy and
 * the projection of its installed graph. `serve()` puts the compiled-module routes in front of that delivery on an
 * allocated port. Nothing reaches a public registry, and the fixtures are never written.
 */
import { cp, mkdtemp, readdir, readFile, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Workspace } from '@beyond-js/packages/workspace';
import { Delivery } from '@beyond-js/packages/artifacts';
import { Execution } from '@beyond-js/packages/execution';
import { Routes } from '@beyond-js/packages/http/routes';
import { FakeRegistry } from '../../cdn-resolution/registry.mjs';
import { declare, install } from './installation.mjs';

const FIXTURE = fileURLToPath(new URL('../fixtures/sources/', import.meta.url));

/**
 * The conditions of a development module for a browser, and of its production output
 */
export const WEB = Object.freeze({ platform: 'web', environment: 'development' });
export const PRODUCTION = Object.freeze({ platform: 'web', environment: 'production' });

/**
 * Every case fails instead of hanging when an installation, a compilation or a request never ends
 */
export const BOUND = { timeout: 180_000 };

export const codes = diagnostics => (diagnostics ?? []).map(({ code }) => code);

/**
 * One installed copy of the fixture, stopped and removed when the test ends
 */
export class Sources {
	#base;
	#registry;
	#workspace;
	#delivery;
	#execution;
	#server;

	get delivery() {
		return this.#delivery;
	}

	/**
	 * The execution projection the copy was installed into
	 */
	get execution() {
		return this.#execution;
	}

	get origin() {
		return `http://127.0.0.1:${this.#server.address().port}`;
	}

	static async install(t) {
		const sources = new Sources();
		t.after(() => sources.stop());
		await sources.#install();
		return sources;
	}

	async #install() {
		this.#base = await realpath(await mkdtemp(join(tmpdir(), 'beyond-sources-')));
		this.#registry = await new FakeRegistry({ prefix: '/npm' }).start();
		const releases = join(FIXTURE, 'registry');
		for (const release of (await readdir(releases)).sort()) await Sources.#publish(this.#registry, join(releases, release));

		const base = this.#base;
		await cp(join(FIXTURE, 'workspace'), join(base, 'workspace'), { recursive: true });
		const declared = await declare(join(base, 'workspace'));
		const { Installation } = await import('@beyond-js/packages/installation');
		// Isolated from this machine: no rc file and no environment of whoever runs the test
		const providers = { values: { default: { registry: this.#registry.url } }, user: false, global: false, env: {} };
		const report = await install(new Installation({ ...declared, store: join(base, 'store'), metadata: join(base, 'metadata'), providers }));
		if (!report.valid) throw new Error(`The fixture did not install: ${JSON.stringify(report.diagnostics)}`);

		// As the host of the development service reads it: the projection with the current inputs and member directories
		const locations = Object.fromEntries(declared.members.map(({ id, path }) => [id, path]));
		const { execution, state } = await Execution.read(declared.root, { inputs: declared.inputs, locations });
		if (state !== 'ready') throw new Error(`The projection of the fixture is ${state}`);
		this.#execution = execution;
		this.#workspace = new Workspace(declared.root, { members: declared.members.map(({ id, path }) => ({ id, path })), execution });
		await this.#workspace.ready;
		this.#delivery = new Delivery(this.#workspace);
	}

	/**
	 * Publishes one release directory: its manifest and every other file, below `package/` of its archive
	 */
	static async #publish(registry, directory) {
		const files = {};
		for (const file of await Sources.#files(directory)) {
			if (file !== 'package.json') files[file] = await readFile(join(directory, file), 'utf8');
		}
		const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
		await registry.publish({ ...manifest, files });
	}

	/**
	 * The files of a release, relative to it with `/` separators
	 */
	static async #files(directory, root = directory) {
		const found = [];
		for (const entry of (await readdir(directory)).sort()) {
			const path = join(directory, entry);
			if ((await stat(path)).isDirectory()) found.push(...(await Sources.#files(path, root)));
			else found.push(relative(root, path).split(sep).join('/'));
		}
		return found;
	}

	/**
	 * Mounts the compiled-module routes of the delivery on an allocated port, as the development service mounts them
	 */
	async serve() {
		const app = express();
		Routes.setup(app, this.#delivery);
		Routes.errors(app);
		this.#server = await new Promise((resolve, reject) => {
			const server = app.listen(0, '127.0.0.1', () => resolve(server)).once('error', reject);
		});
		return this;
	}

	/**
	 * A bounded request of the routes: one that never settles fails the test instead of hanging it
	 */
	get(path) {
		return fetch(new URL(path, this.origin), { signal: AbortSignal.timeout(BOUND.timeout) });
	}

	/**
	 * Ends everything the copy started and removes its directory. Every step runs even when an earlier one fails, so a
	 * failed step never leaves the registry listening or the directory behind; the failures are reported together.
	 */
	async stop() {
		const steps = [
			() => this.#server?.closeAllConnections(),
			() => new Promise(resolve => (this.#server ? this.#server.close(resolve) : resolve())),
			() => this.#delivery?.destroy(),
			() => this.#workspace?.destroy(),
			() => this.#registry?.stop(),
			() => this.#base && rm(this.#base, { recursive: true, force: true })
		];
		const failures = [];
		for (const step of steps) await Promise.resolve().then(step).catch(error => failures.push(error));
		if (failures.length) throw new AggregateError(failures, `Stopping the installed copy failed: ${failures.map(({ message }) => message).join('; ')}`);
	}
}
