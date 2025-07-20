import type { IPackageSpec, IPackageSpecResponse } from '@beyond-js/packages/repositories/types';
import type { Logger } from '@beyond-js/packages/logs';

import {
	RepositoriesErrorManager,
	InvalidRegistryResponse,
	RegistryResponseCouldNotBeParsed
} from '@beyond-js/packages/repositories/errors';

export /*bundle*/ class PackageRegistryFetcher {
	#logger?: Logger;

	#name: string;
	get name() {
		return this.#name;
	}

	#version: string;
	get version() {
		return this.#version;
	}

	#found: boolean;
	get found() {
		return this.#found;
	}

	#value: IPackageSpec;
	get value() {
		return this.#value;
	}

	#error: RepositoriesErrorManager;
	get error() {
		return this.#error;
	}

	get valid() {
		return this.#found && !this.#error;
	}

	constructor(name: string, version: string, logger?: Logger) {
		this.#name = name;
		this.#version = version;
		this.#logger = logger;
	}

	async fetch() {
		const response = await fetch(`https://registry.npmjs.org/${this.#name}/${this.#version}`);

		const { ok, status } = response;
		if (status === 404) {
			this.#found = false;
			return;
		}

		this.#found = true;
		if (!ok) {
			this.#error = new InvalidRegistryResponse(status);
			return;
		}

		try {
			this.#value = <IPackageSpec>await response.json();
		} catch (exc) {
			this.#logger?.error(exc);
			this.#error = new RegistryResponseCouldNotBeParsed();
		}
	}

	json(): IPackageSpecResponse {
		const { name, version, found, value, error, valid } = this;
		return { name, version, found, value, error, valid };
	}
}
