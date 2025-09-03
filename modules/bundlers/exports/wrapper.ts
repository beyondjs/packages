import SourceMap from 'concat-with-sourcemaps';

type In = {
	code: string; // Bundled cjs body
	map: string; // cjs sourcemap
	externals: string[]; // Bare specifiers
	exports: string[]; // Detected named exports
};

type Out = {
	code: string;
	map: string;
};

/**
 * Wrapper builds the final ESM output around the cjs bundle.
 * It injects ESM externals, a cjs-like shim with require/module/exports,
 * and exposes both default and named exports.
 *
 * Sourcemaps are preserved via concatenation.
 */
export class Wrapper {
	build(input: In): Out {
		const { code, map, externals, exports } = input;
		const head = this.#head(externals);
		const shim = this.#shim(externals);
		const foot = this.#foot(exports);

		// Concat keeps mappings aligned across segments.
		// @TODO: The second arg is the final file name; pick any stable name.
		const sourcemap = new SourceMap(true, 'out.js', '\n');

		// Segments without maps
		sourcemap.add(void 0, head);
		sourcemap.add(void 0, shim);

		// Main cjs body with its original map
		sourcemap.add(void 0, code, map);

		// Footer without map
		sourcemap.add(void 0, foot);

		return {
			code: sourcemap.content.toString('utf8'),
			map: sourcemap.sourceMap
		};
	}

	/** Emit static externals for each bare specifier */
	#head(externals: string[]): string {
		let output = '\n';
		for (const id of externals) {
			const alias = this.#alias(id);
			output += `import __ns_${alias} from '${id}';\n`;
		}
		return output;
	}

	/** Emit the cjs compatibility shim: module, exports and require */
	#shim(externals: string[]): string {
		let output = '';
		output += 'function require(id) {\n';
		output += this.#switch(externals) + '\n';
		output += '}\n\n';
		output += 'const module = { exports: {} };\n';
		output += 'const exports = module.exports;\n';
		return output;
	}

	/** Emit final exports: default + named snapshot */
	#foot(exports: string[]): string {
		const output: string[] = [];
		output.push('const __exp = module.exports;');
		output.push('export default __exp;');
		for (const n of exports) output.push(`export const ${n} = __exp.${n};`);
		return output.join('\n');
	}

	/** Emit require switch for externals */
	#switch(externals: string[]): string {
		if (!externals.length) return '  throw new Error("require: no externals");';

		let output = '';
		output += '  switch (id) {\n';
		for (const id of externals) {
			output += `    case '${id}': return __ns_${this.#alias(id)};\n`;
		}
		output += '    default: throw new Error("require: " + id + " not supported");\n';
		output += '  }';
		return output;
	}

	/** Normalize bare specifier into a safe alias */
	#alias(id: string): string {
		return id.replace(/^@/, '').replace(/[^\w]+/g, '_');
	}
}
