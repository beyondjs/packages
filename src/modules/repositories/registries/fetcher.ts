import type { IPackageSpec } from '@beyond-js/packages/repositories/types';
import type { Logger } from '@beyond-js/packages/logs';
import type { IPackageSpecResponse, IPackageVersionsResponse } from './types';
import { InvalidRegistryResponse, RegistryResponseCouldNotBeParsed } from '@beyond-js/packages/repositories/errors';

export interface IRequest {
	host: string;
	headers: Record<string, string>;
	logger?: Logger;
}

export /*bundle*/ class PackageRegistryFetcher {
	/**
	 * Fetch metadata (package.json) for a specific version of a package.
	 *
	 * @param rq Request object containing host, headers, and optional logger
	 * @param name Package name
	 * @param version Package version
	 * @returns
	 */
	static async spec(rq: IRequest, name: string, version: string): Promise<IPackageSpecResponse> {
		const { host, headers, logger } = rq;

		const url = `https://${host}/${name}/${version}`;

		let response: Response;
		try {
			response = await fetch(url, { headers });
		} catch (exc) {
			logger?.error(exc);

			// Network or request-level error
			const error = new InvalidRegistryResponse(0);
			return { host, name, version, found: false, error };
		}

		const { ok, status } = response;

		// Package not found
		if (status === 404) {
			logger?.info(`Package ${name} not found in registry ${host}`);
			return { host, name, version, found: false };
		}

		// Any non-200 and non-404 response
		if (!ok) {
			const error = new InvalidRegistryResponse(status);
			return { host, name, version, found: false, error };
		}

		try {
			const value = <IPackageSpec>await response.json();
			return { host, name, version, found: true, valid: true, value };
		} catch (exc) {
			logger?.error(exc);
			// Response was 200 OK, but the JSON could not be parsed
			const error = new RegistryResponseCouldNotBeParsed();
			return { host, name, version, found: true, valid: false, error };
		}
	}

	/**
	 * Fetch all available versions of a package from a registry.
	 *
	 * @param rq Request object containing host, headers, and optional logger
	 * @param name Package name
	 * @param version Package version
	 * @returns List of versions and status of the fetch operation
	 */
	static async versions(rq: IRequest, name: string): Promise<IPackageVersionsResponse> {
		const { host, headers, logger } = rq;

		const url = `https://${host}/${name}`;
		let response: Response;

		try {
			response = await fetch(url, { headers });
		} catch (exc) {
			logger?.error(exc);

			// Network or request-level error
			const error = new InvalidRegistryResponse(0);
			return { host, name, found: false, error };
		}

		const { ok, status } = response;

		// Package not found
		if (status === 404) {
			logger?.info(`Package ${name} not found in registry ${host}`);
			return { host, name, found: false };
		}

		// Any non-200 and non-404 response
		if (!ok) {
			const error = new InvalidRegistryResponse(status);
			return { host, name, found: false, error };
		}

		try {
			const data = await response.json();
			const versions = typeof data.versions === 'object' ? Object.keys(data.versions) : [];

			return { host, name, found: true, valid: true, value: versions };
		} catch (exc) {
			logger?.error(exc);
			// Response was 200 OK, but the JSON could not be parsed
			const error = new RegistryResponseCouldNotBeParsed();
			return { host, name, found: true, valid: false, error };
		}
	}
}
