import type { IInternalModule } from './index';
import { posix } from 'path';

/**
 * The internal modules an entry point reaches through relative requires, as the runtime resolves them.
 *
 * Every source of a module directory becomes an internal module, and the runtime evaluates every internal module
 * of an artifact when it initialises it. That is what a module meant when its directory was its own; when another
 * public module's entry point lives in the same directory, its sources would be compiled into this one too and
 * their top-level code run twice, once per artifact. An artifact of such a module is made of the internal modules
 * its entry reaches instead (see `Overlap`).
 *
 * A require is read from the emitted body of each internal module (`require("./x")`), which is what every
 * processor emits, and resolved as the runtime resolves it: relative to the requiring module, the exact identity,
 * then without an extension, then the index of a directory.
 */
export class Reach {
	static #REQUIRE = /\brequire\(\s*(['"])(\.{1,2}\/[^'"\n]*|\.{1,2})\1\s*\)/g;

	#ims: Map<string, IInternalModule>;

	constructor(ims: IInternalModule[]) {
		this.#ims = new Map(ims.map(im => [im.id, im]));
	}

	#resolve(from: string, specifier: string): string | undefined {
		const joined = posix.join(posix.dirname(from), specifier);
		const id = joined.startsWith('.') ? joined : `./${joined}`;
		const candidates = [id, id.replace(/\.[a-z]+$/i, ''), `${id.replace(/\/$/, '')}/index`];
		return candidates.find(candidate => this.#ims.has(candidate));
	}

	/**
	 * The internal modules reached from an entry, the entry included, in the order of the given list
	 */
	from(entry: string): IInternalModule[] {
		const reached = new Set<string>();
		const pending = [entry];
		while (pending.length) {
			const id = pending.pop();
			if (reached.has(id) || !this.#ims.has(id)) continue;
			reached.add(id);

			const code = this.#ims.get(id).output.code.code();
			if (typeof code !== 'string') continue;
			for (const [, , specifier] of code.matchAll(Reach.#REQUIRE)) {
				const resolved = this.#resolve(id, specifier);
				resolved && !reached.has(resolved) && pending.push(resolved);
			}
		}
		return [...this.#ims.values()].filter(im => reached.has(im.id));
	}
}
