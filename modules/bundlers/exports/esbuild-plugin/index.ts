import type { Plugin as IPlugin, OnResolveArgs, OnLoadArgs, OnLoadResult, PluginBuild } from 'esbuild';
import { on } from 'events';

export class Plugin implements IPlugin {
	// The plugin name
	get name() {
		return 'esbuild-bundler-plugin';
	}

	#namespace: string;
	get namespace() {
		return this.#namespace;
	}

	#externals: Map<string, string> = new Map();
	get externals() {
		return this.#externals;
	}

	constructor() {
		this.#namespace = 'esbuild-bundler';
	}

	async #resolve(args: OnResolveArgs) {
		console.log('Resolving', args);

		const namespace = this.#namespace;
		const path = args.path;

		return { namespace, path };
	}

	async #load(args: OnLoadArgs): Promise<OnLoadResult> {
		const { namespace, path } = args;

		console.log('Loading', namespace, path);

		const contents = '';
		return { contents };
	}

	setup = (build: PluginBuild) => {
		build.onResolve({ filter: /./ }, this.#resolve.bind(this));
		build.onLoad({ filter: /./ }, this.#load.bind(this));
	};
}
