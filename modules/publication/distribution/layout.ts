import type { IDistributionManifest, IDistributedFile, IDistributedReference, IVariantConditions } from './types';
import { promises as fs } from 'fs';
import { dirname, join, posix } from 'path';
import { Digest } from '../digest';
import { Media } from '../media';

/**
 * One output to lay out, as a generation returned it
 */
export /*bundle*/ interface ILaidOutput {
	kind: 'js' | 'css' | 'map' | 'asset';
	content: string | Uint8Array;
	media?: string;
	of?: 'js' | 'css';
}

export /*bundle*/ interface ILaidVariant {
	subpath: string;
	kind: 'module' | 'style';
	references: IDistributedReference[];
	assets: string[];
	conditions: IVariantConditions;
	format: 'esm' | 'system';
	outputs: ILaidOutput[];
}

/**
 * Writes the files of a precompiled distribution and its manifest into a package directory.
 *
 * It is the counterpart of the reader and knows nothing about compilers: it receives outputs, places each
 * one at `dist/<platform>[/<environment>]/<format>/<subpath>.<extension>`, digests it and lists it. The
 * distribution manifest has a fixed place, `beyond-distribution.json` at the package root, because the
 * publication declaration has no member that could name it. The package manifest is the author's: the
 * declaration that selects the `distribution` form is returned, not written, and nothing here publishes a
 * package.
 */
export /*bundle*/ class Layout {
	#root: string;
	#manifest: IDistributionManifest;

	get manifest() {
		return this.#manifest;
	}

	#compiler: { name: string; version: string };
	#formats: Set<'esm' | 'system'> = new Set();
	#maps = false;

	/**
	 * The value of `beyond.publication` that selects this distribution, once its variants were added
	 */
	get declaration() {
		return { protocol: 'beyond-publication/1', form: 'distribution', compiler: this.#compiler, formats: [...this.#formats].sort(), sourcemaps: this.#maps };
	}

	/**
	 * @param compiler What compiled the outputs, by name and version, as the declaration requires
	 */
	constructor(root: string, pkg: { name: string; version: string }, compiler: { name: string; version: string }) {
		this.#root = root;
		this.#compiler = compiler;
		this.#manifest = { protocol: 'beyond-distribution/1', package: pkg, compiler, modules: {}, assets: {} };
	}

	async #place(file: string, content: string | Uint8Array) {
		const target = join(this.#root, file);
		await fs.mkdir(dirname(target), { recursive: true });
		await fs.writeFile(target, content);
		return { file, digest: Digest.of(content), bytes: Buffer.byteLength(content) };
	}

	/**
	 * Adds the outputs of one public module for one set of conditions and one format
	 */
	async variant(laid: ILaidVariant): Promise<void> {
		const { subpath, kind, references, assets, conditions, format } = laid;
		const name = subpath === '.' ? '~root' : subpath.replace(/^\.\//, '');
		const base = posix.join('dist', conditions.platform, conditions.environment ?? '', format, name);
		const extensions = { js: '.js', css: '.css' };

		this.#formats.add(format);
		this.#maps = this.#maps || laid.outputs.some(({ kind }) => kind === 'map');
		const outputs: IDistributedFile[] = [];
		for (const output of laid.outputs.filter(({ kind }) => kind !== 'asset')) {
			const extension = output.kind === 'map' ? `${extensions[output.of ?? 'js']}.map` : extensions[<'js' | 'css'>output.kind];
			const placed = await this.#place(base + extension, output.content);
			outputs.push(Object.assign({ kind: output.kind, media: output.media ?? Media.of(placed.file), of: output.of }, placed));
		}

		const module = (this.#manifest.modules[subpath] ??= { kind, references, assets, variants: [] });
		module.variants.push({ conditions, format, outputs });
	}

	/**
	 * Adds a declared asset, which keeps its path inside the package
	 */
	async asset(path: string, content: Uint8Array, media?: string): Promise<void> {
		const placed = await this.#place(path, content);
		this.#manifest.assets[path] = Object.assign({ media: media ?? Media.of(path) }, placed);
	}

	/**
	 * Writes the distribution manifest
	 */
	async close(): Promise<void> {
		await fs.writeFile(join(this.#root, 'beyond-distribution.json'), JSON.stringify(this.#manifest, null, '\t'));
	}
}
