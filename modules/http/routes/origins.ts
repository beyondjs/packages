import { promises as fs } from 'fs';
import { dirname, join, relative, sep } from 'path';
import { Endpoint } from '@beyond-js/packages/providers/settings';

/**
 * Where an installed package came from, as the compiled-module contract addresses it
 */
export /*bundle*/ interface IOrigin {
	/**
	 * The registry id of its path: `npm` for the npm registry, which is written unprefixed, or the id Packages'
	 * resolution gives any other registry. Absent when the package came from no registry.
	 */
	registry?: string;

	/**
	 * Why the package has no registry address, such as a Git dependency or an archive URL
	 */
	reason?: string;
}

interface ILock {
	stamp: number;
	packages: Record<string, { resolved?: string; link?: boolean }>;
}

/**
 * The real origin of the packages installed for a workspace, read from what the package manager recorded.
 *
 * A name and a version do not identify a package: the same `react@19.0.0` can come from the npm registry,
 * from a private registry or from a patched copy, and the compiled-module contract writes the registry into
 * the path (`/m/<registry>/react@19.0.0/…`, unprefixed for npm). The origin of an installation is the
 * `resolved` address its lockfile (`package-lock.json` or `node_modules/.package-lock.json`, found from the
 * installation upwards) or its own manifest recorded for it: a registry archive names its registry, whose id is
 * the one Packages' resolution gives it, so a development service and CDN delivery address one package alike.
 *
 * A Git dependency or an archive URL has no registry address, which is reported as the reason. An installation
 * that no lockfile describes, such as one of a package manager that writes no npm lockfile, is taken as npm:
 * that is what an installation without a recorded registry resolves from, and it is a documented limit.
 */
export /*bundle*/ class Origins {
	static NPM = 'npm';

	#locks: Map<string, Promise<ILock | undefined>> = new Map();

	/**
	 * The id of the resolution's origin of a registry, computed by Packages' resolution so that both services
	 * write the same path for one registry
	 */
	static async #provider(endpoint: Endpoint): Promise<string> {
		type IOrigins = { Origin?: { registry(identity: { registry: string; base?: string; visibility: string }): { provider: string } } };
		const { Origin } = <IOrigins>(<unknown>await import('@beyond-js/packages/resolution'));
		if (!Origin) throw new Error('The resolution of Packages does not publish the origin of a registry');
		return Origin.registry({ registry: endpoint.registry, base: endpoint.base, visibility: 'public' }).provider;
	}

	/**
	 * The registry id of the base address of a registry, such as a `publishConfig.registry`
	 *
	 * @returns undefined when the address is not an http(s) registry
	 */
	async registry(base: string): Promise<string | undefined> {
		const endpoint = new Endpoint(base);
		if (!endpoint.valid) return;
		return endpoint.registry === 'registry.npmjs.org' ? Origins.NPM : Origins.#provider(endpoint);
	}

	/**
	 * The origin of an archive address, as a lockfile records it
	 *
	 * @param resolved The `resolved` address of the installation
	 * @param name The name of the package, which a registry archive address carries before `/-/`
	 */
	async resolved(resolved: string | undefined, name: string): Promise<IOrigin> {
		if (!resolved) return { registry: Origins.NPM };
		if (/^(git\+|git:|github:|gitlab:|bitbucket:)/.test(resolved)) return { reason: `"${name}" was installed from Git (${resolved.split('#')[0]}), which has no registry address` };
		if (!/^https?:\/\//.test(resolved)) return { registry: Origins.NPM };

		const url = new URL(resolved);
		const index = url.pathname.lastIndexOf('/-/');
		const encoded = name.replace('/', '%2f');
		const prefix = index === -1 ? '' : url.pathname.slice(0, index);
		const own = [name, encoded, encoded.replace('%2f', '%2F')].find(one => prefix.endsWith(`/${one}`));
		if (!own) return { reason: `"${name}" was installed from an archive address (${url.origin}${url.pathname}), which has no registry address` };

		const registry = await this.registry(`${url.protocol}//${url.host}${prefix.slice(0, -own.length - 1)}`);
		return registry ? { registry } : { reason: `"${name}" was installed from ${url.origin}, which is not a registry address` };
	}

	async #lock(file: string): Promise<ILock | undefined> {
		let stamp: number;
		try {
			stamp = (await fs.stat(file)).mtimeMs;
		} catch {
			return;
		}

		const cached = await this.#locks.get(file);
		if (cached?.stamp === stamp) return cached;

		const read = fs
			.readFile(file, 'utf8')
			.then(text => ({ stamp, packages: JSON.parse(text).packages ?? {} }))
			.catch(() => void 0);
		this.#locks.set(file, read);
		return read;
	}

	/**
	 * What the lockfiles above an installation recorded for it, as they name it: the path of the installation
	 * relative to the directory of the lockfile
	 */
	async #recorded(root: string): Promise<{ resolved?: string; link?: boolean } | undefined> {
		for (let directory = dirname(root); dirname(directory) !== directory; directory = dirname(directory)) {
			// A lockfile names an installation by its path from the lockfile's directory, workspaces included
			const key = relative(directory, root).split(sep).join('/');
			if (!key.startsWith('node_modules/') && !key.includes('/node_modules/')) continue;
			for (const file of [join(directory, 'node_modules', '.package-lock.json'), join(directory, 'package-lock.json')]) {
				const entry = (await this.#lock(file))?.packages[key];
				if (entry) return entry;
			}
		}
	}

	/**
	 * The origin of the package installed at a directory
	 *
	 * @param root The directory of the installed package, as it was located
	 * @param name Its name
	 */
	async installed(root: string, name: string): Promise<IOrigin> {
		const recorded = await this.#recorded(root);
		if (recorded?.link) return { registry: Origins.NPM };
		if (recorded?.resolved) return this.resolved(recorded.resolved, name);

		// A manifest that an older package manager wrote records its own address
		const manifest = await fs
			.readFile(join(root, 'package.json'), 'utf8')
			.then(text => JSON.parse(text))
			.catch(() => ({}));
		return this.resolved(typeof manifest._resolved === 'string' ? manifest._resolved : void 0, name);
	}
}
