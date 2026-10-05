import { satisfies } from 'semver';

/**
 * The range a member of the workspace is selected with, read as npm reads a dependency on a workspace: `*` admits
 * any version, prereleases included; any other range is tested loosely, and admits a prerelease only where a
 * semver range does.
 */
export class MemberRange {
	#value: string;

	/**
	 * @param value The range of a workspace source; empty means any version
	 */
	constructor(value?: string) {
		this.#value = value || '*';
	}

	/**
	 * Whether a member of that version is admitted
	 */
	test(version: string): boolean {
		return this.#value === '*' || satisfies(version, this.#value, { loose: true });
	}
}
