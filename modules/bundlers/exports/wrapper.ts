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
		sourcemap.add('head.js', head);
		sourcemap.add('shim.js', shim);

		// Main cjs body with its original map
		sourcemap.add('cjs.js', code, map);

		// Footer without map
		sourcemap.add('foot.js', foot);

		return {
			code: sourcemap.content.toString('utf8'),
			map: sourcemap.sourceMap
		};
	}

	/** Emit static externals for each bare specifier */
	#head(externals: string[]): string {
		const out: string[] = [];
		for (const id of externals) {
			const alias = this.#alias(id);
			out.push(`import * as __ns_${alias} from '${id}';`);
			out.push(`const __${alias} = ('default' in __ns_${alias} ? __ns_${alias}.default : __ns_${alias});`);
		}
		return out.join('\n');
	}

	/** Emit the cjs compatibility shim: module, exports and require */
	#shim(externals: string[]): string {
		const lines: string[] = [];
		lines.push('const module = { exports: {} };');
		lines.push('const exports = module.exports;');
		lines.push('');
		lines.push('function require(id) {');
		lines.push(this.#switch(externals));
		lines.push('}');
		return lines.join('\n');
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

		const output: string[] = [];
		output.push('  switch (id) {');
		for (const id of externals) {
			output.push(`    case '${id}': return __${this.#alias(id)};`);
		}
		output.push('    default: throw new Error("require: " + id + " not supported");');
		output.push('  }');
		return output.join('\n');
	}

	/** Normalize bare specifier into a safe alias */
	#alias(id: string): string {
		return id.replace(/^@/, '').replace(/[^\w]+/g, '_');
	}
}
