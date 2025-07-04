/**
 * BeyondJS – package exports parser
 */

// Known platform and environment tags
class Tags {
	static platform = new Set(['node', 'browser', 'deno', 'react-native', 'electron', 'worker', 'web']);
	static env = new Set(['development', 'production']);
}

// Data held for each resolved leaf
export class Info {
	constructor(
		public target: string,
		public format?: 'esm' | 'cjs',
		public platform?: string,
		public environment?: string,
		public error?: string
	) {}
}

// Complete export table
export type Table = {
	[subpath: string]: {
		[conditions: string]: Info;
	};
};

// Main parser
export class Parser {
	parse(pkg: any): Table {
		const table: Table = {};
		const exports = this.fallback(pkg);

		for (const [subpath, entry] of Object.entries(exports)) {
			this.walk(entry, subpath, [], table);
		}
		return table;
	}

	// Recursive walk; flattens condition branches
	private walk(node: any, subpath: string, chain: string[], table: Table): void {
		table[subpath] ||= {};

		if (typeof node === 'string') {
			const key = chain.length ? chain.join(':') : 'default';
			table[subpath][key] = this.info(node, chain);
			return;
		}

		if (node && typeof node === 'object') {
			for (const [condition, next] of Object.entries(node)) {
				this.walk(next, subpath, [...chain, condition], table);
			}
			return;
		}

		const key = chain.length ? chain.join(':') : 'default';
		table[subpath][key] = new Info('', undefined, undefined, undefined, `Unsupported type ${typeof node}`);
	}

	// Build Info from path + chain
	private info(path: string, chain: string[]): Info {
		const platform = chain.find(c => Tags.platform.has(c));
		const environment = chain.find(c => Tags.env.has(c));
		const format = chain.includes('import') ? 'esm' : chain.includes('require') ? 'cjs' : undefined;
		return new Info(path, format, platform, environment);
	}

	// Create synthetic `exports` when none provided
	private fallback(pkg: any): Record<string, unknown> {
		if (pkg.exports && typeof pkg.exports === 'object') return pkg.exports;

		const mainPath = pkg.main ?? 'index.js';
		const browser = pkg.browser;
		const exports: Record<string, any> = { '.': mainPath };

		if (typeof browser === 'string') {
			exports['.'] = { browser: browser, default: mainPath };
		} else if (browser && typeof browser === 'object') {
			exports['.'] = {
				browser: browser['.'] ?? browser['./index.js'] ?? mainPath,
				default: mainPath
			};
		}
		return exports;
	}
}
