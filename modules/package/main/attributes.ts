import type { IPackageJSON } from '@beyond-js/packages/types';
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

	#values: IPackageJSON = {};
	get name() {
		return this.#values.name;
	}
	get version() {
		return this.#values.version;
	}
	get vname() {
		return `${this.#values.name}@${this.#values.version}`;
	}
	get description() {
		return this.#values.description;
	}
	get keywords() {
		return this.#values.keywords;
	}
	get author() {
		return this.#values.author;
	}
	get license() {
		return this.#values.license;
	}
	get repository() {
		return this.#values.repository;
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

	process(config: IPackageJSON): boolean {
		const { name, version, description, keywords, author, license, repository } = config;
		const values = { name, version, description, keywords, author, license, repository };

		if (equal(values, this.#values)) return false;
		this.#values = values;
		return true;
	}
}
