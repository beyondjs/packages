import type { Plugin as IPlugin, OnResolveArgs, OnLoadArgs, OnLoadResult, PluginBuild } from 'esbuild';
import type { Conditional } from './conditional';
import { resolve, dirname } from 'path';
import * as fs from 'fs';

const { readFile } = fs.promises;

export class Plugin implements IPlugin {
	// The plugin name
	get name() {
		return 'esbuild-bundler-plugin';
	}

	#conditional: Conditional;

	#externals: Set<string> = new Set();
	get externals(): string[] {
		return Array.from(this.#externals);
	}

	constructor(conditional: Conditional) {
		this.#conditional = conditional;
	}

	async #resolve(args: OnResolveArgs) {
		console.log('Resolving', args);

		let { path } = args;
		const { kind, importer } = args;

		// flags for spec type
		const is: any = {};
		is.url = /^(https?:|data:|node:)/i.test(path);
		is.absposix = path.startsWith('/');
		is.abswin = /^[A-Za-z]:[\\/]/.test(path);
		is.abs = is.absposix || is.abswin;
		is.rel = path === '.' || path === '..' || path.startsWith('./') || path.startsWith('../');
		is.bare = !is.url && !is.abs && !is.rel;

		// Base dir for relative resolution
		const root = this.#conditional.module.package.path;
		const impdir = importer ? dirname(importer) : root;

		// Bare specifiers or URL specifiers
		if (is.bare || is.url) {
			this.#externals.add(args.path);
			return { external: true };
		}

		// Abs or rel specifiers
		return { namespace: 'beyondjs-bundler', path: is.abs ? path : resolve(impdir, path) };
	}

	async #load(args: OnLoadArgs): Promise<OnLoadResult> {
		try {
			const { path } = args;
			const contents = await readFile(path, 'utf-8');
			return { contents };
		} catch (exc) {
			return;
		}
	}

	setup = (build: PluginBuild) => {
		build.onResolve({ filter: /./ }, this.#resolve.bind(this));
		build.onLoad({ filter: /./, namespace: 'beyondjs-bundler' }, this.#load.bind(this));
	};
}
