import * as lexer from 'cjs-module-lexer';
import { existsSync, readFileSync, statSync } from 'fs';
import { dirname, extname, join, relative, sep } from 'path';

/**
 * How the entry point of an ordinary npm package is published as a native ES module.
 *
 * An ES module entry is compiled as it is. A CommonJS entry has no static export names, so a consumer that
 * writes `import { useState } from 'react'` would find nothing: its names are read with the lexer Node
 * itself uses, following `module.exports = require('./file')` re-exports through every environment branch,
 * and a generated entry re-exports them together with the default, which is the value of `module.exports`.
 * A name that only one environment defines is `undefined` in the other, never a build error.
 */
export /*bundle*/ class Interop {
	#file: string;
	#type?: string;
	#via: string[];

	/**
	 * @param file The resolved entry point file
	 * @param type The `type` field of the package manifest
	 * @param via The conditions or manifest field that selected the file
	 */
	constructor(file: string, type: string | undefined, via: string[]) {
		this.#file = file;
		this.#type = type;
		this.#via = via;
	}

	/**
	 * `esm` or `cjs`, decided by the extension, the package type, the selecting condition and, last, by
	 * whether the file has static import or export statements
	 */
	get format(): 'esm' | 'cjs' {
		const extension = extname(this.#file);
		if (extension === '.mjs' || extension === '.mts') return 'esm';
		if (extension === '.cjs' || extension === '.cts' || extension === '.json') return 'cjs';
		if (this.#type === 'module') return 'esm';
		if (this.#via.includes('require')) return 'cjs';
		if (this.#via.includes('import') || this.#via.includes('module')) return 'esm';
		return /^\s*(import\s*[\w{*'"]|export\s+[\w{*])/m.test(readFileSync(this.#file, 'utf8')) ? 'esm' : 'cjs';
	}

	#locate(from: string, request: string): string | undefined {
		const base = join(dirname(from), request);
		const candidates = [base, `${base}.js`, `${base}.cjs`, join(base, 'index.js')];
		return candidates.find(candidate => existsSync(candidate) && statSync(candidate).isFile());
	}

	#names(file: string, visited: Set<string>, names: Set<string>): void {
		if (visited.has(file) || extname(file) === '.json') return;
		visited.add(file);

		let parsed: { exports: string[]; reexports: string[] };
		try {
			parsed = lexer.parse(readFileSync(file, 'utf8'));
		} catch {
			return;
		}
		parsed.exports.forEach(name => names.add(name));
		parsed.reexports.forEach(request => {
			const target = request.startsWith('.') && this.#locate(file, request);
			target && this.#names(target, visited, names);
		});
	}

	/**
	 * The generated entry point of a CommonJS entry, or undefined for an ES module entry
	 *
	 * @param root The directory the generated entry point is resolved from. The entry is named relatively
	 * to it, so the generated code, which a source map carries, does not depend on where the package is.
	 */
	async facade(root: string): Promise<string | undefined> {
		if (this.format === 'esm') return;
		await lexer.init();

		const names: Set<string> = new Set();
		this.#names(this.#file, new Set(), names);
		const valid = [...names].filter(name => name !== 'default' && name !== '__esModule' && /^[A-Za-z_$][\w$]*$/.test(name)).sort();

		const target = JSON.stringify(`./${relative(root, this.#file).split(sep).join('/')}`);
		const named = valid.length ? `export { ${valid.join(', ')} } from ${target};\n` : '';
		return `${named}export { default } from ${target};\n`;
	}
}
