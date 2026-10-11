import type { Confinement } from '@beyond-js/packages/confinement';
import { existsSync, readFileSync, realpathSync, statSync } from 'fs';
import { basename } from 'path';

/**
 * The file system the Vue compiler reads through when its package is compiled confined.
 *
 * Resolving a type that a `<script setup>` imports (`defineProps<Props>()` with `Props` from another file)
 * makes the compiler read the file that declares it, and the names of its properties become the runtime props
 * of the component: left to itself it reads that file wherever it is. Confined, it sees only files whose real
 * location is inside the package, and no `tsconfig.json`, whose `extends`, `include` and references
 * TypeScript would follow through its own file system. A type it cannot read is reported by the compiler.
 */
export class Files {
	#confinement: Confinement;

	constructor(confinement: Confinement) {
		this.#confinement = confinement;
	}

	/**
	 * The compiler calls these members detached from this object, so they are bound
	 */
	fileExists = (file: string): boolean => {
		if (basename(file) === 'tsconfig.json' || !this.#confinement.contains(file) || !existsSync(file)) return false;
		return statSync(file).isFile() && this.#confinement.inside(file);
	};

	readFile = (file: string): string | undefined => (this.fileExists(file) ? readFileSync(file, 'utf8') : void 0);

	realpath = (file: string): string => (this.fileExists(file) ? realpathSync(file) : file);
}
