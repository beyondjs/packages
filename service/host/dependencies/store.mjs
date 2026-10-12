import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Where the plans of a workspace are kept: one document per plan in `<root>/.beyond/dependencies/plans/<id>.json`,
 * the state of the service that no file route lists or changes and that Git ignores. A plan is written whole through
 * a temporary file and a rename, readable by its user only; plans older than the retention are removed when the
 * service starts.
 */
export class PlanStore {
	static #ID = /^pln_[0-9a-f]{24}$/;

	/**
	 * Milliseconds a plan is kept after it was created
	 */
	static RETENTION = 7 * 24 * 3600 * 1000;

	#root;
	#directory;

	/**
	 * @param {string} root The canonical root of the workspace
	 */
	constructor(root) {
		this.#root = root;
		this.#directory = join(root, '.beyond', 'dependencies', 'plans');
	}

	/**
	 * A new plan identifier: `pln_` and 24 hexadecimal digits
	 */
	static id() {
		return `pln_${randomBytes(12).toString('hex')}`;
	}

	/**
	 * Whether a value can be the identifier of a plan, which is what keeps a request inside this directory
	 */
	static valid(id) {
		return typeof id === 'string' && PlanStore.#ID.test(id);
	}

	async #prepare() {
		await mkdir(this.#directory, { recursive: true });
		const ignore = join(this.#root, '.beyond', '.gitignore');
		if (!existsSync(ignore)) await writeFile(ignore, '*\n');
	}

	/**
	 * @param {{id: string}} plan
	 */
	async write(plan) {
		if (!PlanStore.valid(plan?.id)) throw new Error(`Invalid plan identifier "${plan?.id}"`);
		await this.#prepare();
		const file = join(this.#directory, `${plan.id}.json`);
		const temporary = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
		await writeFile(temporary, `${JSON.stringify(plan, null, '\t')}\n`, { mode: 0o600 });
		await rename(temporary, file);
	}

	/**
	 * @param {string} id
	 * @returns {Promise<object | undefined>} undefined for a plan that is not there or cannot be read
	 */
	async read(id) {
		if (!PlanStore.valid(id)) return;
		try {
			return JSON.parse(await readFile(join(this.#directory, `${id}.json`), 'utf8'));
		} catch {
			return;
		}
	}

	/**
	 * Adds fields to a stored plan
	 *
	 * @param {string} id
	 * @param {object} fields
	 */
	async update(id, fields) {
		const plan = await this.read(id);
		if (!plan) return;
		const updated = { ...plan, ...fields };
		await this.write(updated);
		return updated;
	}

	/**
	 * Removes the plans older than the retention, and the temporary files of a writer that died
	 *
	 * @param {number} now
	 */
	async sweep(now = Date.now()) {
		let names = [];
		try {
			names = await readdir(this.#directory);
		} catch {
			return;
		}
		for (const name of names) {
			const file = join(this.#directory, name);
			const { mtimeMs } = (await stat(file).catch(() => void 0)) ?? {};
			if (mtimeMs === undefined) continue;
			const old = name.endsWith('.tmp') ? now - mtimeMs > 60000 : now - mtimeMs > PlanStore.RETENTION;
			old && (await rm(file, { force: true }));
		}
	}
}
