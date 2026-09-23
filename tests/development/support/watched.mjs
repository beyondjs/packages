import { cp, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hosted } from '../../../service/host/hosted.mjs';
import { Description } from '../../../service/host/description.mjs';

const fixtures = fileURLToPath(new URL('../fixtures/', import.meta.url));

/**
 * A copy of a fixture served as the development service hosts a workspace: watched by the real watchers
 * service, with the state that `GET /state` answers. The route reloads changed manifests and then builds every
 * public module; `state()` does the same with the same objects, without HTTP.
 *
 * The watchers service must be running (`WatchersService`, named `watchers`, which is the name every package
 * of the workspace connects to).
 */
export class Watched {
	#root;
	#hosted;
	#description;

	get root() {
		return this.#root;
	}

	/**
	 * Copies a fixture into a unique temporary directory and serves it; the copy and the workspace are released
	 * when the test ends, on failure as well
	 *
	 * @param {import('node:test').TestContext} t
	 * @param {string} fixture The directory under `fixtures/`
	 */
	static async open(t, fixture) {
		const watched = new Watched();
		t.after(() => watched.destroy());
		await watched.#open(fixture);
		return watched;
	}

	async #open(fixture) {
		this.#root = await realpath(await mkdtemp(join(tmpdir(), `beyond-${fixture}-`)));
		await cp(join(fixtures, fixture), this.#root, { recursive: true });

		const settings = { root: this.#root, standalone: false };
		this.#hosted = new Hosted(settings, () => void 0);
		await this.#hosted.ready;
		this.#description = new Description(settings, this.#hosted);
	}

	file(path) {
		return join(this.#root, ...path.split('/'));
	}

	/**
	 * What the state route reports for a module now
	 */
	async module(specifier) {
		await this.#hosted.refresh();
		const { modules } = await this.#description.state();
		return modules.find(module => module.specifier === specifier);
	}

	/**
	 * Asks for the state without pausing until the module has the expected status, as a client that polls
	 * does, and fails naming what the service still reports when the bound is reached
	 */
	async until(specifier, status, what, ms = 15000) {
		const deadline = Date.now() + ms;
		let last;
		while (Date.now() < deadline) {
			last = await this.module(specifier);
			if (last?.status === status) return last;
			await new Promise(resolve => setImmediate(resolve));
		}
		throw new Error(`${what}: after ${ms} ms the service still reports ${JSON.stringify(last)}`);
	}

	async destroy() {
		this.#hosted?.destroy();
		this.#hosted = undefined;
		this.#root && (await rm(this.#root, { recursive: true, force: true }));
	}
}
