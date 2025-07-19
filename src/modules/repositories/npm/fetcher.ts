import type { IPackageJson } from './npm';

import {
	RepositoriesErrorManager,
	InvalidRegistryResponse,
	RegistryResponseCouldNotBeParsed
} from '@beyond-js/packages/repositories/errors';

export interface ISpecsResponse {
	name: string;
	version: string;
	found: boolean;
	value: IPackageJson;
	error: RepositoriesErrorManager;
	valid: boolean;
}

export /*bundle*/ class PackageRegistryFetcher {
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

	#value: IPackageJson;
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

	constructor(name: string, version: string) {
		this.#name = name;
		this.#version = version;
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
			this.#value = <IPackageJson>await response.json();
		} catch (exc) {
			console.error(exc.stack);
			this.#error = new RegistryResponseCouldNotBeParsed();
		}
	}

	toJSON(): ISpecsResponse {
		const { name, version, found, value, error, valid } = this;
		return { name, version, found, value, error, valid };
	}
}
