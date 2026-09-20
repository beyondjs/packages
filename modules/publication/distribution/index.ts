import type { IDiagnostic } from '@beyond-js/packages/types';
import type { IDistributionManifest, IDistributedFile, IDistributedModule, IVariant, IVariantConditions } from './types';
import { promises as fs } from 'fs';
import { join, normalize, sep } from 'path';
import { Digest } from '../digest';

/**
 * One prebuilt output, read from the package and verified against the digest its manifest lists
 */
export /*bundle*/ interface IDistributedOutput extends IDistributedFile {
	content: Buffer;
}

/**
 * Reads a precompiled distribution: which public modules it holds, what they reference and the prebuilt
 * outputs of a module for the requested conditions and format.
 *
 * Nothing is compiled, transformed or parsed as code. An output whose bytes do not match the digest of the
 * manifest is refused, and a variant the distribution does not hold is a diagnostic that names the ones it
 * does, because a distribution cannot produce what it was not built for.
 */
export /*bundle*/ class Distribution {
	static get protocol() {
		return 'beyond-distribution/1';
	}

	#root: string;
	get root() {
		return this.#root;
	}

	#manifest: IDistributionManifest;
	get manifest() {
		return this.#manifest;
	}

	#diagnostics: IDiagnostic[] = [];
	get diagnostics() {
		return this.#diagnostics;
	}

	get valid() {
		return !!this.#manifest && !this.#diagnostics.length;
	}

	/**
	 * The public modules of the distribution, by subpath (`.`, `./widget`)
	 */
	get modules(): Map<string, IDistributedModule> {
		return new Map(Object.entries(this.#manifest?.modules ?? {}));
	}

	private constructor(root: string) {
		this.#root = root;
	}

	/**
	 * @param root The extracted package root
	 * @param file The distribution manifest, relative to the root, as `Publication.read` returned it
	 */
	static async open(root: string, file: string): Promise<Distribution> {
		const distribution = new Distribution(root);
		await distribution.#read(file);
		return distribution;
	}

	async #read(file: string): Promise<void> {
		const fail = (code: string, message: string) => void this.#diagnostics.push({ code, message });

		let manifest: IDistributionManifest;
		try {
			manifest = JSON.parse(await fs.readFile(this.#inside(file), 'utf8'));
		} catch (exc) {
			// The reason is reported by its code: the message of the system names the extraction directory
			return fail('DISTRIBUTION_MANIFEST_UNREADABLE', `Distribution manifest "${file}" cannot be read (${exc.code ?? 'invalid JSON'})`);
		}

		if (manifest?.protocol !== Distribution.protocol) {
			const message = `Distribution manifest "${file}" declares the protocol "${manifest?.protocol}"; this implementation reads "${Distribution.protocol}"`;
			return fail('DISTRIBUTION_PROTOCOL_UNKNOWN', message);
		}
		if (!manifest.modules || typeof manifest.modules !== 'object') {
			return fail('DISTRIBUTION_MANIFEST_INVALID', `Distribution manifest "${file}" does not list its modules`);
		}
		manifest.assets = manifest.assets ?? {};
		this.#manifest = manifest;
	}

	// A listed file never leaves the package
	#inside(file: string): string {
		const resolved = normalize(join(this.#root, file));
		if (resolved !== this.#root && !resolved.startsWith(this.#root + sep)) throw new Error(`"${file}" is outside the package`);
		return resolved;
	}

	#variant(module: IDistributedModule, conditions: IVariantConditions, format: string): IVariant | undefined {
		const platform = conditions.platform === 'web' ? 'browser' : conditions.platform;
		const candidates = module.variants.filter(variant => variant.format === format && variant.conditions.platform === platform);
		const exact = candidates.find(variant => variant.conditions.environment === conditions.environment);
		// A variant compiled without an environment serves every environment
		return exact ?? candidates.find(variant => !variant.conditions.environment);
	}

	async #verified(listed: IDistributedFile, diagnostics: IDiagnostic[]): Promise<IDistributedOutput | undefined> {
		try {
			const content = await fs.readFile(this.#inside(listed.file));
			if (Digest.of(content) === listed.digest) return Object.assign({}, listed, { content });
			diagnostics.push({ code: 'DISTRIBUTION_DIGEST_MISMATCH', message: `"${listed.file}" does not match the digest of the distribution manifest` });
		} catch (exc) {
			diagnostics.push({ code: 'DISTRIBUTION_FILE_MISSING', message: `"${listed.file}" cannot be read (${exc.code ?? 'unreadable'})` });
		}
	}

	/**
	 * The prebuilt outputs of a public module. They are returned complete or not at all.
	 */
	async outputs(request: { subpath: string; conditions: IVariantConditions; format: 'esm' | 'system' }) {
		const diagnostics: IDiagnostic[] = [];
		const { subpath, conditions, format } = request;
		const done = (outputs: IDistributedOutput[] = []) => ({ outputs: diagnostics.length ? [] : outputs, diagnostics });

		const module = this.#manifest?.modules[subpath];
		if (!module) {
			diagnostics.push({ code: 'MODULE_NOT_FOUND', message: `The distribution does not hold the module "${subpath}"` });
			return done();
		}

		const variant = this.#variant(module, conditions, format);
		if (!variant) {
			const held = module.variants.map(({ conditions: { platform, environment }, format }) => [platform, environment, format].filter(Boolean).join('/'));
			const asked = [conditions.platform, conditions.environment, format].filter(Boolean).join('/');
			const message = `Module "${subpath}" was not distributed for "${asked}" (held: ${held.join(', ') || 'none'}). Publish a distribution that includes it, or publish the source form`;
			diagnostics.push({ code: 'DISTRIBUTION_VARIANT_MISSING', message });
			return done();
		}

		const outputs = await Promise.all(variant.outputs.map(listed => this.#verified(listed, diagnostics)));
		return done(outputs);
	}

	/**
	 * A declared asset of the distribution, by its path relative to the package root
	 */
	async asset(path: string) {
		const diagnostics: IDiagnostic[] = [];
		const listed = this.#manifest?.assets[path];
		if (!listed) {
			diagnostics.push({ code: 'ASSET_NOT_FOUND', message: `The distribution does not declare the asset "${path}"` });
			return { diagnostics };
		}
		const output = await this.#verified(Object.assign({ kind: <const>'asset' }, listed), diagnostics);
		return { output, diagnostics };
	}
}
