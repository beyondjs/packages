import { cp, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Workspace } from '@beyond-js/packages/workspace';
import { Delivery } from '@beyond-js/packages/artifacts';
import { Routes, Sources } from '@beyond-js/packages/http/routes';

/**
 * The workspace of `fixtures/contract`, served by the HTTP routes of the development service over a real
 * delivery on an allocated port. The fixture is copied into a unique temporary directory, and its `installed/`
 * directories become the `node_modules` of the copy — the one change of layout, because the checked-in
 * fixture keeps no `node_modules` directory — so the installed packages sit where a package manager puts them,
 * described by the lockfile of the workspace. Read `fixtures/contract/README.md`.
 */
export class Served {
	static FIXTURE = fileURLToPath(new URL('../fixtures/contract/', import.meta.url));

	#root;
	get root() {
		return this.#root;
	}

	#server;
	#workspace;
	#delivery;

	/**
	 * What a host gives its extensions over this delivery, as the development service does: the delivery and
	 * the source each package is addressed by
	 */
	get facade() {
		const delivery = this.#delivery;
		const sources = new Sources(delivery);
		return {
			published: () => delivery.published(),
			module: (request, conditions) => delivery.module(request, conditions),
			supplies: (name, version) => delivery.supplies(name, version),
			origin: (name, version) => sources.origin(name, version),
			registry: base => sources.origins.registry(base)
		};
	}

	get origin() {
		return `http://127.0.0.1:${this.#server.address().port}`;
	}

	async start() {
		this.#root = await realpath(await mkdtemp(join(tmpdir(), 'beyond-development-contract-')));
		await cp(join(Served.FIXTURE, 'workspace'), this.#root, { recursive: true });
		await cp(join(Served.FIXTURE, 'installed/root'), join(this.#root, 'node_modules'), { recursive: true });
		await cp(join(Served.FIXTURE, 'installed/legacy'), join(this.#root, 'legacy/node_modules'), { recursive: true });

		this.#workspace = new Workspace(this.#root);
		this.#delivery = new Delivery(this.#workspace);
		const app = express();
		Routes.setup(app, this.#delivery);
		Routes.errors(app);
		this.#server = await new Promise(resolve => {
			const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
		});
		return this;
	}

	get(relative, headers = {}) {
		return fetch(`${this.origin}${relative}`, { headers });
	}

	async stop() {
		this.#server?.closeAllConnections();
		await new Promise(resolve => (this.#server ? this.#server.close(resolve) : resolve()));
		this.#workspace?.destroy();
		this.#root && (await rm(this.#root, { recursive: true, force: true }));
	}
}
