/**
 * Utility to detect whether a version string follows a basic semver pattern.
 * Note: This is a simplified check and should be replaced by a proper semver library if needed.
 */
export class Semver {
	static is(version: string): boolean {
		return /^[~^]?(\d+\.)?(\d+\.)?(\*|\d+)$/.test(version) || /^\d/.test(version);
	}
}
