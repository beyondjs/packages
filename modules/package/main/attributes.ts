import type { IPackageManifest } from '@beyond-js/packages/types';
import type { Config } from '@beyond-js/config/main';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';
import { equal } from '@beyond-js/equal/main';
import { createHash } from 'crypto';

export default class extends DynamicProcessor() {
	get dp() {
		return 'package';
	}

	#id: string;
	get id(): string {
		return this.#id;
	}

	#config: Config;
	get config() {
		return this.#config;
	}

	get path() {
		return this.#config.path;
	}

	#manifest: IPackageManifest = {};
	get manifest() {
		return this.#manifest;
	}

	// Package attributes, shortcuts to the manifest properties
	get name() {
		return this.#manifest.name;
	}
	get version() {
		return this.#manifest.version;
	}
	get vname() {
		return `${this.#manifest.name}@${this.#manifest.version}`;
	}
	get description() {
		return this.#manifest.description;
	}
	get keywords() {
		return this.#manifest.keywords;
	}
	get author() {
		return this.#manifest.author;
	}
	get license() {
		return this.#manifest.license;
	}
	get repository() {
		return this.#manifest.repository;
	}
	get dependencies() {
		return this.#manifest.dependencies;
	}
	get devDependencies() {
		return this.#manifest.devDependencies;
	}
	get peerDependencies() {
		return this.#manifest.peerDependencies;
	}
	get optionalDependencies() {
		return this.#manifest.optionalDependencies;
	}
	get bundledDependencies() {
		return this.#manifest.bundledDependencies;
	}
	get bundleDependencies() {
		return this.#manifest.bundleDependencies;
	}
	get peerDependenciesMeta() {
		return this.#manifest.peerDependenciesMeta;
	}

	async _begin() {
		await super._begin();

		const { config } = this;
		await config.initialise();
	}

	constructor(config: Config) {
		super();
		super.setup(new Map([['config', { child: config }]]));

		this.#config = config;
		this.#id = createHash('md5').update(this.path).digest('hex').toString();
	}

	process(config: IPackageManifest): boolean {
		const { name, version, description, keywords, author, license, repository } = config;
		const values = { name, version, description, keywords, author, license, repository };

		if (equal(values, this.#manifest)) return false;
		this.#manifest = values;
		return true;
	}
}
