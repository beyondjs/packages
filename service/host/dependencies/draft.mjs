import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import semver from 'semver';
import { Inputs } from '../../workspace/inputs.mjs';
import { Canonical } from '../../workspace/canonical.mjs';
import { ManifestText } from './text.mjs';

/**
 * A plan's changes applied in memory: the manifest edits they need, the workspace as an installation would read it
 * once they are written, and the preferences its resolution uses. Nothing is written.
 *
 * - **Edits** are made on the text of each manifest (`ManifestText`), so what a plan shows is what applying it writes:
 *   `{member, path, group, name, before, after}`, `path` being the manifest as a path of the File API (null for a
 *   member outside the served root, which the File API does not write: `MANIFEST_OUTSIDE_ROOT`).
 * - **Preferences** are the lock's releases, so unrelated nodes keep their versions while the result stays valid,
 *   except for the names the changes release (a change with neither range nor version, and the peers a plan releases
 *   when they block a requested change); a requested version is pinned, and a locked version of the same name above
 *   it is not offered, so the request also wins where the range admits both.
 */
export class Draft {
	#snapshot;
	#changes;
	#edits = [];
	#texts = new Map();
	#diagnostics = [];
	#members;
	#manifest;
	#inputs;
	#pins;
	#released;

	/**
	 * @param {import('./snapshot.mjs').Snapshot} snapshot
	 * @param {import('./changes.mjs').Changes} changes
	 */
	constructor(snapshot, changes) {
		this.#snapshot = snapshot;
		this.#changes = changes;
	}

	/**
	 * Reads the manifests the changes write to and applies the edits to their text
	 *
	 * @throws {import('./error.mjs').DependencyError} `CHANGE_UNDECLARED`
	 */
	async compose() {
		const snapshot = this.#snapshot;
		const importers = snapshot.importers;
		const { writes, pins, released } = this.#changes.resolve(importers);
		this.#pins = pins;
		this.#released = released;

		const edited = new Map();
		for (const write of writes) {
			const importer = importers.find(({ id }) => id === write.importer);
			const text = await this.#text(importer);
			if (!text) continue;
			const before = text.get(write.group, write.name);
			if (before === write.range) continue;
			text.set(write.group, write.name, write.range);
			edited.set(importer.id, JSON.parse(text.text));
			this.#edits.push({ member: importer.id, path: importer.file ?? null, group: write.group, name: write.name, before: before ?? null, after: write.range });
		}

		const { declaration } = snapshot;
		this.#members = declaration.members.map(({ id, name, version, path, manifest }) => ({ id, name, version, path, manifest: edited.get(id) ?? manifest }));
		const root = importers.find(one => one.root);
		this.#manifest = (root && edited.get(root.id)) ?? edited.get('.') ?? declaration.manifest;
		this.#inputs = Inputs.compute({ kind: declaration.kind, members: this.#members, manifest: this.#manifest });
		return this;
	}

	/**
	 * The text of an importer's manifest, read once; undefined, with a diagnostic, when it cannot be edited
	 */
	async #text(importer) {
		if (this.#texts.has(importer.id)) return this.#texts.get(importer.id);
		let text;
		try {
			text = new ManifestText(await readFile(join(importer.path, 'package.json'), 'utf8'));
		} catch (error) {
			const message = `The manifest of ${importer.id} cannot be edited: ${error?.message ?? error}`;
			this.#diagnostics.push({ code: 'MANIFEST_INVALID', message, severity: 'error', kind: 'manifest', importer: importer.id });
		}
		if (text && !importer.file) {
			const message = `The manifest of ${importer.id} is outside the served root, where the service writes nothing: edit it there`;
			this.#diagnostics.push({ code: 'MANIFEST_OUTSIDE_ROOT', message, severity: 'error', kind: 'manifest', importer: importer.id });
		}
		this.#texts.set(importer.id, text);
		return text;
	}

	get edits() {
		return this.#edits.map(edit => ({ ...edit }));
	}

	/**
	 * Why a manifest cannot be edited
	 */
	get diagnostics() {
		return [...this.#diagnostics];
	}

	/**
	 * The names the changes ask for
	 */
	get requested() {
		return this.#changes.names;
	}

	/**
	 * The exact versions the changes ask for
	 */
	get pins() {
		return this.#pins.map(pin => ({ ...pin }));
	}

	/**
	 * The canonical digest of the inputs the workspace will declare once the edits are written
	 */
	get inputs() {
		return Canonical.digest(this.#inputs);
	}

	/**
	 * What an installation of the edited workspace is made from, as the development service gives it
	 */
	get params() {
		const { root, declaration } = this.#snapshot;
		const members = this.#members.map(({ id, name, version, path, manifest }) => ({ id, name, version, path, manifest }));
		return { root, members, inputs: this.#inputs, ...(declaration.kind === 'standalone' ? {} : { manifest: this.#manifest }) };
	}

	/**
	 * The preferences of the resolution: the lock's releases but those of the names released, and the pins
	 *
	 * @param {string[]} [more] Names released besides the changes' own
	 * @returns {{name: string, version: string}[]}
	 */
	preferences(more = []) {
		const released = new Set([...this.#released, ...more]);
		const pinned = new Map(this.#pins.map(({ name, version }) => [name, version]));
		const nodes = Object.values(this.#snapshot.lock.document?.nodes ?? {});
		const kept = nodes
			.filter(node => node?.origin?.provider !== 'workspace' && typeof node?.name === 'string' && typeof node?.version === 'string')
			.filter(({ name, version }) => !released.has(name) && !(pinned.has(name) && semver.valid(version) && semver.gt(version, pinned.get(name))))
			.map(({ name, version }) => ({ name, version }));
		const listed = [...kept, ...this.#pins];
		const unique = new Map(listed.map(pin => [`${pin.name}@${pin.version}`, pin]));
		return [...unique.values()].sort((a, b) => (`${a.name}@${a.version}` < `${b.name}@${b.version}` ? -1 : 1));
	}
}
