import type { Conditional } from '../main';
import { createHash } from 'crypto';
import { isAbsolute, relative, sep } from 'path';

/**
 * The identity of one source file of a module, from which a processor derives the identifiers that join
 * its outputs: the scope a framework gives the styles of a component, which its code writes as classes or
 * attributes and its stylesheet selects.
 *
 * It is the identity of the package the file belongs to — the node key and integrity of a pinned package,
 * the name and version of a workspace package — and the path of the file in that package. Components of
 * different sources, packages or modules that have the same path inside them therefore get different
 * identifiers, and the same component gets the same one wherever its sources were extracted. The
 * conditions are deliberately not part of it, so a server render and the client that hydrates it agree,
 * and neither is the content, so an edit keeps the identifier a mounted view already carries.
 */
export /*bundle*/ class Scope {
	#value: string;

	/**
	 * What the identifiers are derived from: the package identity and the file's path in the package
	 */
	get value(): string {
		return this.#value;
	}

	/**
	 * @param conditional The conditional whose processor compiles the file
	 * @param file The absolute path of the file, as its processor reads it
	 */
	constructor(conditional: Conditional, file: string) {
		const pkg = conditional.module.package;
		const path = relative(pkg.path, file);
		const inside = path && !path.startsWith('..') && !isAbsolute(path);
		if (!inside) throw new Error(`The source "${file}" is not a file of package "${pkg.vname}"`);

		this.#value = JSON.stringify([pkg.identity, path.split(sep).join('/')]);
	}

	/**
	 * A hexadecimal digest of the identity, of the given length
	 */
	hash(length = 8): string {
		return createHash('sha256').update(this.#value).digest('hex').slice(0, length);
	}
}
