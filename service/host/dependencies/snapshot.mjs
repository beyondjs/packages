import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import semver from 'semver';
import { Declaration } from '../../workspace/declaration.mjs';
import { Canonical } from '../../workspace/canonical.mjs';
import { Composition } from '../composition.mjs';

// The groups of a manifest, and the type each one declares
const GROUPS = Object.freeze({ dependencies: 'prod', devDependencies: 'dev', peerDependencies: 'peer', optionalDependencies: 'optional' });

/**
 * What the workspace is on disk at one moment, as dependency management reads it: the declaration (members and the
 * digests of their inputs), the lock, the state of the projection, the importers and what each one declares, and the
 * packages the toolchain supplies. Reading it never writes anything.
 *
 * - `base` is what a plan is made against: `lock`, the revision of the lock file's bytes (`absent` without one), so
 *   any change of the lock is seen, and `inputs`, the canonical digest of the declaration's inputs, so any change of
 *   what a manifest declares is seen.
 * - `lock.digest` is the digest of the lock's content when the file is a `beyond-lock/2` document whose recorded
 *   digest is its own: the identity a plan's proposed lock is compared with.
 */
export class Snapshot {
	static LOCK = 'beyond-lock.json';
	static GROUPS = GROUPS;

	#root;
	#declaration;
	#lock;
	#projection;
	#supplied;

	/**
	 * Reads the workspace now
	 *
	 * @param {string} root The canonical root
	 * @param {{Execution: object, supplied?: {name: string, path: string}[]}} options The class that reads the
	 * projection, and the packages the toolchain supplies (the settings of the host)
	 */
	static async read(root, { Execution, supplied = [] }) {
		const declaration = Declaration.read(root);
		const lock = await Snapshot.#lockfile(join(root, Snapshot.LOCK));
		const projection = await Execution.read(root, Composition.current(declaration));
		return new Snapshot(root, { declaration, lock, projection, supplied: Snapshot.#versions(supplied) });
	}

	constructor(root, { declaration, lock, projection, supplied }) {
		this.#root = root;
		this.#declaration = declaration;
		this.#lock = lock;
		this.#projection = projection;
		this.#supplied = supplied;
	}

	get root() {
		return this.#root;
	}

	get declaration() {
		return this.#declaration;
	}

	/**
	 * `{present, revision, digest?, document?, problem?}`: `document` is the parsed lock when it is a `beyond-lock/2`
	 * document with members, nodes and edges
	 */
	get lock() {
		return this.#lock;
	}

	/**
	 * The canonical digest of the declaration's inputs
	 */
	get inputs() {
		return Canonical.digest(this.#declaration.inputs);
	}

	get base() {
		return { lock: this.#lock.revision, inputs: this.inputs };
	}

	/**
	 * The state of the projection (`ready`, `missing`, `stale`, `incomplete`, `incompatible`) and its diagnostics
	 */
	get installation() {
		const { state, diagnostics = [] } = this.#projection;
		return { state, diagnostics };
	}

	/**
	 * The projection, when it is ready, stale or incomplete
	 */
	get execution() {
		return this.#projection.execution;
	}

	/**
	 * The packages the toolchain supplies, with their versions: `[{name, version, path}]`
	 */
	get supplied() {
		return this.#supplied;
	}

	/**
	 * The importers of the workspace as its graph takes them: every member whose manifest can be used, and the root
	 * package (`.`) when it declares dependencies without being a member. Each is `{id, name, version, manifest,
	 * path, file}`, `file` being its manifest as a path of the File API, or undefined outside the root.
	 */
	get importers() {
		const { members, manifest, kind } = this.#declaration;
		const usable = members.filter(({ name, version, manifest }) => typeof name === 'string' && name && semver.valid(version) && manifest && typeof manifest === 'object');
		const importers = usable.map(({ id, name, version, manifest, path }) => ({ id, name, version, manifest, path, file: this.#file(path) }));
		const declares = manifest && Object.keys(GROUPS).some(group => manifest[group] && typeof manifest[group] === 'object' && Object.keys(manifest[group]).length);
		if (kind !== 'standalone' && declares && !members.some(({ id }) => id === '.')) {
			const version = semver.valid(manifest.version) ? manifest.version : '0.0.0';
			importers.push({ id: '.', name: typeof manifest.name === 'string' && manifest.name ? manifest.name : '.', version, manifest, path: this.#root, file: 'package.json', root: true });
		}
		return importers;
	}

	/**
	 * What an installation of the workspace as it is now is made from, as the development service gives it
	 */
	get params() {
		const { members, inputs, manifest, kind } = this.#declaration;
		const listed = members.map(({ id, name, version, path, manifest }) => ({ id, name, version, path, manifest }));
		return { root: this.#root, members: listed, inputs, ...(kind === 'standalone' ? {} : { manifest }) };
	}

	/**
	 * What one importer declares now: `[{name, range, group, type}]`
	 *
	 * @param {{manifest: object}} importer
	 */
	static declared({ manifest }) {
		const declared = [];
		for (const [group, type] of Object.entries(GROUPS)) {
			const entries = manifest?.[group];
			if (!entries || typeof entries !== 'object' || Array.isArray(entries)) continue;
			for (const [name, range] of Object.entries(entries)) typeof range === 'string' && declared.push({ name, range, group, type });
		}
		return declared;
	}

	/**
	 * Whether two bases name the same lock and inputs
	 */
	static same(a, b) {
		return !!a && !!b && a.lock === b.lock && a.inputs === b.inputs;
	}

	/**
	 * A directory's manifest as a path of the File API: relative to the root in POSIX form, or undefined when it is
	 * outside the root, where the File API writes nothing
	 */
	#file(path) {
		const file = relative(this.#root, join(path, 'package.json'));
		if (!file || file.startsWith('..') || file.includes(`..${sep}`)) return;
		return file.split(sep).join('/');
	}

	static async #lockfile(path) {
		let bytes;
		try {
			bytes = await readFile(path);
		} catch (error) {
			if (error?.code === 'ENOENT') return { present: false, revision: 'absent' };
			return { present: true, revision: 'unreadable', problem: `it could not be read (${error?.code ?? 'unknown error'})` };
		}
		const revision = `sha256-${createHash('sha256').update(bytes).digest('hex')}`;
		let data;
		try {
			data = JSON.parse(bytes.toString('utf8'));
		} catch {
			return { present: true, revision, problem: 'it is not valid JSON' };
		}
		const shaped = data?.protocol === 'beyond-lock/2' && data.nodes && typeof data.nodes === 'object' && data.members && Array.isArray(data.edges);
		if (!shaped) return { present: true, revision, problem: 'it is not a beyond-lock/2 document' };
		const { digest, ...content } = data;
		const own = Canonical.digest(content) === digest;
		return { present: true, revision, document: data, ...(own ? { digest } : { problem: 'the digest it records is not its own' }) };
	}

	/**
	 * The supplied packages with the version of their manifest; one whose manifest cannot be read is left out
	 */
	static #versions(supplied) {
		const listed = [];
		for (const { name, path } of Array.isArray(supplied) ? supplied : []) {
			try {
				const { version } = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'));
				typeof name === 'string' && typeof version === 'string' && listed.push({ name, version, path });
			} catch {
				// A package the toolchain could not describe is not one it supplies
			}
		}
		return listed;
	}
}
