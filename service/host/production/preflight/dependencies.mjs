import semver from 'semver';

/**
 * The dependencies of a package that point at the workspace, as a registry consumer would install them: what its
 * manifest declares in `dependencies`, `peerDependencies` and `optionalDependencies` (never `devDependencies`, which a
 * consumer does not install), checked against the members of the workspace.
 *
 * npm publishes a range as it is written, so a range a registry cannot resolve fails every consumer:
 *
 * | Code | Severity | When |
 * | --- | --- | --- |
 * | `DEPENDENCY_WORKSPACE_PROTOCOL` | error | `workspace:` (another package manager's protocol, which npm does not replace) |
 * | `DEPENDENCY_LOCAL` | error | `file:`, `link:` or a path: it names this machine |
 * | `DEPENDENCY_PRIVATE` | error | A member that declares `private: true`, which no registry will hold |
 * | `DEPENDENCY_RANGE_UNSATISFIED` | warning | The member's version is outside the range |
 * | `DEPENDENCY_MEMBER` | info | A member: it is published first, or consumers cannot install this package |
 */
export class Dependencies {
	static TYPES = ['dependencies', 'peerDependencies', 'optionalDependencies'];

	#manifest;
	#members;

	/**
	 * @param {object} manifest The package's manifest
	 * @param {{id: string, name: string, version: string, manifest?: object}[]} members The members of the workspace
	 */
	constructor(manifest, members) {
		this.#manifest = manifest;
		this.#members = members;
	}

	static #local(range) {
		return /^(file:|link:|\.{0,2}\/|~\/)/.test(range);
	}

	/**
	 * @returns {{dependencies: object[], findings: {code: string, severity: string, message: string}[]}}
	 */
	check() {
		const dependencies = [];
		const findings = [];
		const finding = (code, severity, message) => findings.push({ code, severity, message });

		for (const type of Dependencies.TYPES) {
			const declared = this.#manifest[type];
			if (!declared || typeof declared !== 'object') continue;
			for (const [name, value] of Object.entries(declared)) {
				const range = String(value);
				const member = this.#members.find(one => one.name === name);
				const entry = { name, range, type, ...(member ? { member: member.id, version: member.version, private: member.manifest?.private === true } : {}) };
				dependencies.push(entry);

				if (range.startsWith('workspace:')) {
					finding('DEPENDENCY_WORKSPACE_PROTOCOL', 'error', `"${name}" is declared as "${range}": npm publishes it as written and no registry resolves it; declare a version range`);
					continue;
				}
				if (Dependencies.#local(range)) {
					finding('DEPENDENCY_LOCAL', 'error', `"${name}" is declared as "${range}", a location on this machine that consumers do not have`);
					continue;
				}
				if (!member) continue;
				if (entry.private) {
					finding('DEPENDENCY_PRIVATE', 'error', `"${name}" is the member "${member.id}", which declares "private": true: no registry will hold it, so consumers cannot install this package`);
					continue;
				}
				const valid = semver.validRange(range);
				if (valid && member.version && !semver.satisfies(member.version, valid)) {
					finding('DEPENDENCY_RANGE_UNSATISFIED', 'warning', `"${name}" is required as "${range}", and the member "${member.id}" is ${member.version}`);
				}
				finding('DEPENDENCY_MEMBER', 'info', `"${name}" is the member "${member.id}" (${member.version}): publish it first, or consumers cannot install this package`);
			}
		}
		return { dependencies, findings };
	}
}
