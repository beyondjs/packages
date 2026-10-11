import { randomBytes } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { Deadline } from '../../deadline.mjs';
import { Archive } from './archive.mjs';
import { ExportError } from './error.mjs';
import { Records } from './records.mjs';
import { Roots } from './roots.mjs';
import { Slots } from './slots.mjs';
import { Transfer } from './transfer.mjs';

/**
 * Durable source exports of a workspace (`beyond-dev-exports/1`): the saved sources of selected packages frozen as
 * reproducible archives, kept with their manifests, digests and sizes until they expire, and transferred to a pending
 * Snapshots capture with the upload grants a person obtained there.
 *
 * An export is `{id, protocol, state, created, expires, packages: [{path, name, version, manifest, digest, bytes,
 * files, excluded, omitted?}], capture?, transfer?: {packages: [{path, state, error?}]}, error?}`; `state` is `ready`
 * or `failed`, `files` lists the files an archive holds and `excluded` what it left out by reason (see `Listing`). Exports expire after `BEYOND_EXPORT_RETENTION` (24 hours) and are swept at start and every hour. A
 * transfer that a stop of the service interrupted leaves its packages `unknown`, and the client asks Snapshots for new
 * grants and transfers again. Every change is announced as `export.changed` on the service's events.
 *
 * ```js
 * const exports = new Exports(root, { events, environment: process.env });
 * await exports.start();
 * const created = await exports.create(['.', 'packages/widgets']);
 * await exports.transfer(created.id, { capture: { id }, grants });
 * ```
 */
export class Exports {
	static PROTOCOL = 'beyond-dev-exports/1';
	static RETENTION = new Deadline('BEYOND_EXPORT_RETENTION', 86400000);
	static UPLOAD = new Deadline('BEYOND_EXPORT_UPLOAD_TIMEOUT', 120000);
	static SWEEP = 3600000;

	#records;
	#roots;
	#events;
	#retention;
	#timeout;
	#origins;
	#limits;
	#clock;
	#slots = new Slots(2);
	#active = new Map();
	#writes = new Map();
	#pending = new Set();
	#timer;

	/**
	 * @param {string} root The canonical root of the workspace
	 * @param {{events?: import('../events.mjs').Events, environment?: object, clock?: () => number, limits?: {bytes?:
	 * number, files?: number}}} [options] Where changes are announced, the environment that configures retention, the
	 * upload bound and the allowed Snapshots origins (`BEYOND_SNAPSHOTS_ORIGINS`, separated by commas), the time
	 * (tests give their own) and the bounds of one archive
	 */
	constructor(root, { events, environment = process.env, clock = Date.now, limits } = {}) {
		this.#records = new Records(root);
		this.#roots = new Roots(root);
		this.#events = events;
		this.#retention = Exports.RETENTION.read(environment);
		this.#timeout = Exports.UPLOAD.read(environment);
		this.#origins = Exports.origins(environment);
		this.#clock = clock;
		this.#limits = limits;
	}

	/**
	 * The allowed Snapshots origins an environment names: https origins, or http ones on a loopback name (`127.0.0.1`,
	 * `[::1]`, `localhost` and every name under it, such as `http://snapshots.beyond.localhost:<port>`)
	 *
	 * @param {object} environment
	 * @returns {string[]}
	 * @throws {Error} For a value that is not one, which fails the start of the service
	 */
	static origins(environment) {
		const values = String(environment.BEYOND_SNAPSHOTS_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean);
		return values.map(value => {
			let url;
			try {
				url = new URL(value);
			} catch {
				throw new Error(`BEYOND_SNAPSHOTS_ORIGINS names "${value}", which is not an origin`);
			}
			if (!Transfer.secure(url)) throw new Error(`BEYOND_SNAPSHOTS_ORIGINS names "${value}", which is neither an https origin nor an http one on a loopback name`);
			return url.origin;
		});
	}

	/**
	 * What `/session` lists for exports
	 */
	get capabilities() {
		return { exports: 1 };
	}

	/**
	 * Sweeps what expired, leaves the packages of an interrupted transfer `unknown`, and sweeps every hour
	 */
	async start() {
		const { records } = await this.#records.list();
		for (const record of records) {
			const interrupted = record.transfer?.packages.filter(({ state }) => state === 'queued' || state === 'uploading') ?? [];
			if (!interrupted.length) continue;
			const error = { code: 'EXPORT_INTERRUPTED', message: 'The development service stopped during the transfer: ask Snapshots whether it stored this package, or for new grants' };
			interrupted.forEach(entry => Object.assign(entry, { state: 'unknown', error }));
			await this.#records.write(record);
		}
		await this.sweep();
		this.#timer = setInterval(() => this.sweep().catch(() => void 0), Exports.SWEEP);
		this.#timer.unref();
	}

	/**
	 * Stops sweeping and ends the transfers that run; their packages are left as the record says
	 */
	stop() {
		clearInterval(this.#timer);
		this.#active.forEach(({ transfer }) => transfer.cancel());
	}

	#expired(record) {
		return !(Date.parse(record.expires) > this.#clock());
	}

	/**
	 * Removes the exports that expired and the directories without a readable record
	 */
	async sweep() {
		const { records, unreadable } = await this.#records.list();
		for (const record of records.filter(record => this.#expired(record))) await this.remove(record.id);
		for (const id of unreadable.filter(id => !this.#pending.has(id))) await this.#records.remove(id);
	}

	/**
	 * Freezes the packages named by their paths
	 *
	 * @param {unknown} paths
	 * @returns {Promise<object>} The export, `failed` when a package could not be archived
	 * @throws {ExportError} `EXPORT_PACKAGE_INVALID`, before anything is written
	 */
	async create(paths) {
		const roots = this.#roots.resolve(paths);
		const id = `exp_${randomBytes(16).toString('hex')}`;
		const created = this.#clock();
		this.#pending.add(id);
		try {
			await this.#records.create(id);
			const packages = roots.map(({ path, manifest }) => ({ path, name: manifest.name, version: manifest.version, manifest }));
			const record = { id, protocol: Exports.PROTOCOL, state: 'ready', created: new Date(created).toISOString(), expires: new Date(created + this.#retention).toISOString(), packages };

			for (const [index, { directory, members, manifest }] of roots.entries()) {
				try {
					const archive = new Archive(directory, { manifest, members, ...this.#limits });
					Object.assign(packages[index], await archive.write(this.#records.archive(id, index)));
				} catch (error) {
					const failure = error instanceof ExportError ? error : new ExportError('EXPORT_FAILED', `The package could not be archived (${error.code ?? error.message})`);
					Object.assign(record, { state: 'failed', error: failure.described });
					packages[index].error = failure.described;
					break;
				}
			}
			if (record.state === 'failed') await this.#discard(id, roots.length);
			await this.#records.write(record);
			this.#announce(record);
			return record;
		} finally {
			this.#pending.delete(id);
		}
	}

	/**
	 * The archives of a failed export are not kept: nothing can be transferred from it
	 */
	async #discard(id, count) {
		for (let index = 0; index < count; index++) await rm(this.#records.archive(id, index), { force: true });
	}

	/**
	 * The exports that have not expired
	 */
	async list() {
		const { records } = await this.#records.list();
		return records.filter(record => !this.#expired(record));
	}

	/**
	 * @param {string} id
	 * @throws {ExportError} `EXPORT_NOT_FOUND`
	 */
	async get(id) {
		const record = this.#active.get(id)?.record ?? (await this.#records.read(id));
		if (!record || this.#expired(record)) throw new ExportError('EXPORT_NOT_FOUND', `There is no export "${id}", or it expired`);
		return record;
	}

	/**
	 * Removes an export and its archives, cancelling a transfer that runs
	 *
	 * @param {string} id
	 * @returns {Promise<boolean>} Whether there was one
	 */
	async remove(id) {
		const active = this.#active.get(id);
		active?.transfer.cancel();
		this.#active.delete(id);
		const record = await this.#records.read(id);
		await this.#writes.get(id)?.catch(() => void 0);
		this.#writes.delete(id);
		await this.#records.remove(id);
		return !!record;
	}

	/**
	 * Starts a transfer of an export to a pending capture
	 *
	 * @param {string} id
	 * @param {unknown} body `{capture: {id}, grants: [{path, upload, token, expires}]}`
	 * @returns {Promise<object>} The export as the transfer begins
	 * @throws {ExportError} `EXPORT_NOT_FOUND`, `EXPORT_CONFLICT`, `EXPORT_TRANSFER_INVALID`, `EXPORT_DESTINATION`
	 */
	async transfer(id, body) {
		// A transfer whose packages all have an outcome has ended, even while its last state is being written
		const running = this.#active.get(id)?.record.transfer.packages.some(({ state }) => state === 'queued' || state === 'uploading');
		if (running) throw new ExportError('EXPORT_CONFLICT', 'A transfer of this export runs: follow it, or remove the export to cancel it');
		const transfer = Transfer.prepare(await this.get(id), body, { origins: this.#origins });

		const active = { transfer, record: transfer.record };
		this.#active.set(id, active);
		await this.#save(active.record);

		const answer = structuredClone(active.record);
		const archives = new Map(active.record.packages.map(({ path, digest, bytes }, index) => [path, { file: this.#records.archive(id, index), digest, bytes }]));
		const save = async (path, outcome) => {
			const entry = active.record.transfer.packages.find(one => one.path === path);
			delete entry.error;
			Object.assign(entry, outcome);
			await this.#save(active.record);
		};
		transfer
			.start({ archives, slots: this.#slots, timeout: this.#timeout, save })
			.catch(() => void 0)
			.finally(() => this.#active.get(id) === active && this.#active.delete(id));
		return answer;
	}

	/**
	 * Writes a record after the writes of the same export before it, and announces it
	 */
	async #save(record) {
		const snapshot = structuredClone(record);
		const previous = this.#writes.get(record.id) ?? Promise.resolve();
		const write = previous.catch(() => void 0).then(() => this.#records.write(snapshot));
		this.#writes.set(record.id, write);
		await write;
		this.#announce(snapshot);
	}

	#announce({ id, state, expires, capture, transfer }) {
		this.#events?.emit('export.changed', { export: { id, state, expires, ...(capture ? { capture } : {}), ...(transfer ? { transfer } : {}) } });
	}
}
