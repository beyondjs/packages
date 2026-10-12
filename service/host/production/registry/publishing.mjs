import { ProductionError } from '../error.mjs';

/**
 * The work of a publication (`production.publish`): an archive that was packed and inspected goes to a registry once,
 * with its outcome read from the registry rather than assumed.
 *
 * 1. `check`: the registry's status of the version, compared with the archive. The same content already published
 *    ends the work (`already-published`, nothing sent); other content under the version is `VERSION_EXISTS` and
 *    nothing is sent, ever; a refusal (`REGISTRY_REFUSED`), an outage (`REGISTRY_UNAVAILABLE`) or an answer that
 *    cannot be compared (`REGISTRY_UNVERIFIABLE`) also send nothing, and their outcome is known.
 * 2. `publish`: the archive's bytes are read and compared with its record (`ARCHIVE_CHANGED`), and npm publishes it
 *    ([Publisher](./publisher.mjs)).
 * 3. `verify`: the registry is read again. Whatever npm said, what the registry holds decides: the archive's content
 *    there is `published` (also after an npm failure, `reconciled`); nothing there after a failure of npm is
 *    `PUBLISH_FAILED` with npm's code, and nothing was published; a registry that cannot be read after npm did not
 *    answer, or failed, is `PUBLISH_UNKNOWN`: the version may be published, and the next publication reads the
 *    registry before sending anything. After npm succeeded, a registry that does not show the version yet is still
 *    `published`, with `verified: false`.
 *
 * A request is never sent twice: a publication that a stop of the service interrupted is `interrupted`, and the next
 * one starts again at `check`.
 */
export class Publishing {
	static STEPS = Object.freeze([
		{ id: 'check', expected: { median: 1500, p90: 6000 } },
		{ id: 'publish', expected: { median: 8000, p90: 30000 } },
		{ id: 'verify', expected: { median: 1500, p90: 6000 } }
	]);

	#registry;
	#publisher;
	#archives;

	/**
	 * @param {{registry: import('./registry.mjs').Registry, publisher: import('./publisher.mjs').Publisher, archives:
	 * import('../packing/archives.mjs').Archives}} collaborators
	 */
	constructor({ registry, publisher, archives }) {
		this.#registry = registry;
		this.#publisher = publisher;
		this.#archives = archives;
	}

	static #refusals = {
		'version-exists-different': ['VERSION_EXISTS', 'The registry holds this version with other content. A version is never overwritten: publish a new version'],
		refused: ['REGISTRY_REFUSED', 'The registry refused the credentials of this machine: log in with npm (npm login --registry <url>) and try again'],
		unavailable: ['REGISTRY_UNAVAILABLE', 'The registry could not be read, so nothing was sent: try again when it answers'],
		unverifiable: ['REGISTRY_UNVERIFIABLE', 'The registry holds this version and its content cannot be compared with the archive, so nothing was sent']
	};

	/**
	 * @param {import('../../operations/operation.mjs').Operation} operation
	 * @param {{archive: object, registry: string, access: string, tag: string, directory: string}} request The archive's
	 * record, where it goes, and the package's directory (whose configuration applies)
	 * @returns {Promise<object>} The result of the operation
	 */
	async run(operation, { archive, registry, access, tag, directory }) {
		const { name, version } = archive;
		const read = () => this.#registry.status({ name, version, registry, archive, directory });

		const check = operation.step('check').begin();
		const before = await read();
		check.done();
		if (before.state === 'published-matching') {
			operation.step('publish').skip();
			operation.step('verify').skip();
			return { outcome: 'already-published', status: before };
		}
		const refusal = Publishing.#refusals[before.state];
		if (refusal) throw new ProductionError(refusal[0], `${refusal[1]} (${before.reason ?? before.state})`, { status: before });

		const publish = operation.step('publish').begin({ phase: 'npm' });
		await this.#archives.bytes(archive);
		publish.current(`${name}@${version} to ${registry}`);
		const npm = await this.#publisher.run({ file: this.#archives.file(archive), registry, access, tag });
		const succeeded = npm.exit === 0 && !npm.expired;
		// A failure of npm is not yet an outcome: the registry decides it, and the step waits for that reading
		const unconfirmed = { code: npm.expired ? 'PUBLISH_TIMEOUT' : npm.code ?? 'PUBLISH_FAILED', message: 'npm did not confirm the publication: the registry is read to learn its outcome' };
		succeeded ? publish.done() : publish.stall(unconfirmed);

		const verify = operation.step('verify').begin();
		const after = await read();
		verify.done();
		const report = { exit: npm.exit, ...(npm.code ? { code: npm.code } : {}), expired: npm.expired, output: npm.output };
		if (after.state === 'published-matching') {
			publish.done();
			return { outcome: 'published', verified: true, ...(succeeded ? {} : { reconciled: true }), status: after, npm: report };
		}
		if (succeeded && after.state === 'not-published') return { outcome: 'published', verified: false, status: after, npm: report };
		if (after.state === 'version-exists-different') throw new ProductionError('VERSION_EXISTS', 'The registry holds this version with other content now: nothing was overwritten', { status: after, npm: report });
		if (!succeeded && after.state === 'not-published') {
			const message = npm.expired ? 'npm did not finish in time and the registry does not hold the version: nothing was published' : `npm failed (${npm.code ?? `exit ${npm.exit}`}) and the registry does not hold the version: nothing was published`;
			throw new ProductionError(npm.code === 'E401' || npm.code === 'E403' || npm.code === 'ENEEDAUTH' || npm.code === 'EOTP' ? 'REGISTRY_REFUSED' : 'PUBLISH_FAILED', message, { status: after, npm: report });
		}
		const message = 'Whether the version was published is unknown: the registry could not be read afterwards. Publish again: it reads the registry before sending anything';
		throw new ProductionError('PUBLISH_UNKNOWN', message, { status: after, npm: report, outcome: 'unknown' });
	}
}
