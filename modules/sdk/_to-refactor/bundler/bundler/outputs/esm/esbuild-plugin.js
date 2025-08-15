/**
 * Plugin to load ims from memory, using a Map of internal modules
 */
module.exports = class Plugin {
	name = 'beyond-module-esbuild-plugin';
	#conditional;
	#ims;
	#entry;

	constructor(conditional, ims, entry) {
		this.#conditional = conditional;
		this.#ims = ims;
		this.#entry = entry;
	}

	setup = build => {
		// Resolve relative paths
		build.onResolve({ filter: /^\.{1,2}\// }, args => {
			const importer = args.importer === 'entry-point' ? '' : args.importer;
			const resolved = '.' + new URL(args.path, 'file://' + importer).pathname;

			return { path: resolved, namespace: 'relative-path' };
		});

		// Resolve non-relative paths and the entry point
		build.onResolve({ filter: /^[^./]/ }, args => {
			// The entry point is a special case defined as a non-relative path, because it is set as
			// non-relative in the esbuild configuration (check index.js).
			if (args.kind === 'entry-point') return { path: 'entry-point', namespace: 'entry-point' };

			return { path: args.path, namespace: 'non-relative-path' };
		});

		// Return the code of the entry point
		build.onLoad({ filter: /.*/, namespace: 'entry-point' }, args => {
			return { contents: this.#entry.code };
		});

		// Return the content of the internal modules (non-relative paths)
		build.onLoad({ filter: /^\.{1,2}\//, namespace: 'relative-path' }, args => {
			const key = args.path.slice(2); // Remove the leading './'
			const im = this.#ims.get(key);
			if (!im) throw new Error(`File not found in ims: ${args.path}`);

			return {
				contents: im.generated.code({ sourcemap: 'inline' }),
				resolveDir: '.'
			};
		});

		// Handle extenals (non-relative paths)
		build.onLoad({ filter: /^[^./]/, namespace: 'non-relative-path' }, args => {});
	};
};
