import type { Confinement } from '@beyond-js/packages/confinement';
import { dirname, resolve } from 'path';

/**
 * The dynamic imports the compiler expands on its own.
 *
 * An `import()` or a `require()` whose argument is a template literal with substitutions (`./locales/${lang}`),
 * or a string concatenated with something else (`'./locales/' + lang`), is a pattern: the compiler lists the
 * directories it can match and reads every file it finds there, without asking any plugin to resolve them. A
 * pattern whose fixed beginning leaves the package would have it list, and walk, directories of the machine,
 * and so would a pattern that climbs (`..`) after a substitution. A confined build refuses the file that holds
 * such a pattern before the compiler parses it. Only a relative pattern is expanded by the compiler; any other
 * is a dynamic import whose target is unknown, which the analysis reports on its own.
 */
export class Globs {
	/**
	 * A template literal argument, or a quoted one followed by a concatenation
	 */
	static PATTERN = /\b(?:import|require)\s*\(\s*(?:`((?:\\[\s\S]|[^`\\])*)`|(['"])((?:\\[\s\S]|(?!\2)[^\\])*)\2\s*\+)/g;

	#confinement: Confinement;

	constructor(confinement: Confinement) {
		this.#confinement = confinement;
	}

	/**
	 * The fixed beginning of the first pattern of a source that the compiler would expand outside the package,
	 * as the source writes it; undefined when it has none
	 */
	escape(file: string, contents: string): string | undefined {
		for (const [, template, , quoted] of contents.matchAll(Globs.PATTERN)) {
			const parts = template === void 0 ? [quoted] : template.split('${');
			if (template !== void 0 && parts.length < 2) continue;

			const [prefix] = parts;
			if (!/^\.\.?\//.test(prefix)) continue;

			// What follows each substitution, which climbs from a directory no one can know in advance
			const rest = parts.slice(1).map(part => part.slice(part.indexOf('}') + 1));
			const climbs = rest.some(part => /(^|\/)\.\.(\/|$)/.test(part));
			if (climbs || !this.#confinement.contains(resolve(dirname(file), prefix))) return prefix;
		}
	}
}
