/**
 * The version selected for each dependency occurrence in a resolution pass, by occurrence id. A pass is
 * walked with the selection of the previous one; the resolution is settled when a pass confirms it.
 */
export class Selection extends Map<string, string> {
	equals(other: Selection): boolean {
		if (other.size !== this.size) return false;
		for (const [id, version] of this) if (other.get(id) !== version) return false;
		return true;
	}
}
