import { mkdir, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { Archive } from '../../exports/archive.mjs';
import { Dependencies } from './dependencies.mjs';
import { Surface } from './surface.mjs';

/**
 * What publishing a package would publish, read before anything is packed or sent (`GET /production/packages/:member`):
 *
 * - its name, version, `private`, and its publication form, read by Packages' `Publication` (`beyond-publication/1`
 *   `source` or `distribution`, or an ordinary npm package; an invalid declaration selects no form);
 * - the registry it goes to (its `publishConfig.registry`, else the registry npm's configuration gives its scope,
 *   else the default one), the access and the tag;
 * - the file set of its archive and what that leaves out by reason, from a dry run of the source export's
 *   [Archive](../../exports/archive.mjs) (the same rules as the archive that `production.pack` writes);
 * - its public subpaths with their targets and declarations ([Surface](./surface.mjs));
 * - its dependencies that point at the workspace ([Dependencies](./dependencies.mjs));
 * - the findings, each `{code, severity, message, paths?}`; the package is `ready` when none is an error.
 *
 * | Code | Severity | When |
 * | --- | --- | --- |
 * | `PACKAGE_PRIVATE` | error | `"private": true`: npm refuses to publish it |
 * | `PUBLICATION_*` | error | An invalid `beyond.publication` (warning: `PUBLICATION_UNDECLARED`) |
 * | `EXPORT_TARGET_EXCLUDED` | error | A public subpath resolves to a file the archive leaves out |
 * | `DISTRIBUTION_MANIFEST_EXCLUDED` | error | A `distribution` whose `beyond-distribution.json` is left out |
 * | `DECLARATION_EXCLUDED` | warning | The manifest names a declaration the archive leaves out |
 * | `MAIN_EXCLUDED`, `BIN_EXCLUDED` | warning | `main` or a `bin` file is left out (npm would add it; this archive does not) |
 * | `SECRETS_EXCLUDED` | warning | Files that look like credentials were found and left out |
 * | `FILE_SUSPICIOUS` | warning | A file the archive holds is named like a secret |
 * | `SCRIPTS_NOT_RUN` | warning | The manifest declares `prepack`, `prepare` or `prepublishOnly`: no package script runs |
 */
export class Preflight {
	static PROTOCOL = 'beyond-production/1';
	static #SUSPICIOUS = /(secret|credential|password|passwd|private[-_.]?key|\.env\b|token)/i;
	static #SCRIPTS = ['prepack', 'prepare', 'prepublish', 'prepublishOnly', 'postpack'];

	#member;
	#modules;
	#state;

	/**
	 * @param {{id: string, directory: string, manifest: object, members: string[]}} member The package
	 * @param {{Publication: {read(manifest: object): object}, Exports: Function, members: object[], registry:
	 * (manifest: object) => Promise<{url: string, source: string}>, published?: string[], declaration?: (subpath:
	 * string) => Promise<object>}} modules Packages' readers, the members of the workspace, the registry npm's
	 * configuration gives the package, the subpaths of its Beyond public modules and how a generated declaration is asked
	 * @param {string} state The directory where the dry run writes, below `.beyond`
	 */
	constructor(member, modules, state) {
		this.#member = member;
		this.#modules = modules;
		this.#state = state;
	}

	/**
	 * The file set of the archive, by a dry run of the source export's archive
	 */
	async #files() {
		const { directory, manifest, members } = this.#member;
		await mkdir(this.#state, { recursive: true });
		const file = join(this.#state, `preflight-${randomBytes(8).toString('hex')}.tar`);
		try {
			return await new Archive(directory, { manifest, members }).write(file);
		} finally {
			await rm(file, { force: true });
		}
	}

	/**
	 * The default access of npm: a scoped package is published `restricted` unless told otherwise
	 */
	static #access(manifest) {
		const declared = manifest.publishConfig?.access;
		if (declared === 'public' || declared === 'restricted') return declared;
		return manifest.name.startsWith('@') ? 'restricted' : 'public';
	}

	/**
	 * @returns {Promise<object>} The preflight document
	 */
	async read() {
		const { manifest, id } = this.#member;
		const { Publication, Exports, members, registry, published = [], declaration } = this.#modules;
		const findings = [];
		const finding = (code, severity, message, paths) => findings.push({ code, severity, message, ...(paths?.length ? { paths: paths.slice(0, 50) } : {}) });

		const publication = Publication.read(manifest);
		// A declaration that cannot be read selects no form and is an error; one that is absent beside Beyond modules warns
		publication.diagnostics.forEach(({ code, message }) => finding(code, code === 'PUBLICATION_UNDECLARED' ? 'warning' : 'error', message));
		manifest.private === true && finding('PACKAGE_PRIVATE', 'error', `"${manifest.name}" declares "private": true, and npm refuses to publish it`);

		const listing = await this.#files();
		const included = new Set(listing.files);
		const surface = await new Surface({ manifest, form: publication.form, files: listing.files, Exports, modules: published, declaration }).list();
		for (const entry of surface) {
			for (const { target, included: held } of [entry, entry.browser ?? {}]) {
				if (target !== undefined && held === false) finding('EXPORT_TARGET_EXCLUDED', 'error', `"${entry.subpath}" resolves to "${target}", which the archive leaves out`, [target]);
			}
			entry.types.state === 'excluded' && finding('DECLARATION_EXCLUDED', 'warning', `The declaration of "${entry.subpath}" is "${entry.types.file}", which the archive leaves out`, [entry.types.file]);
		}
		this.#fields(manifest, included, publication, finding);

		const secrets = listing.excluded.secrets ?? [];
		secrets.length && finding('SECRETS_EXCLUDED', 'warning', `${secrets.length} file(s) named like credentials were found and are never archived`, secrets);
		const suspicious = listing.files.filter(path => Preflight.#SUSPICIOUS.test(path.split('/').at(-1)));
		suspicious.length && finding('FILE_SUSPICIOUS', 'warning', `${suspicious.length} file(s) the archive holds are named like secrets: check that they hold none`, suspicious);
		const scripts = Preflight.#SCRIPTS.filter(name => typeof manifest.scripts?.[name] === 'string');
		scripts.length && finding('SCRIPTS_NOT_RUN', 'warning', `No package script runs when the archive is made (${scripts.join(', ')}): run what they prepare before packing`);

		const workspace = new Dependencies(manifest, members).check();
		findings.push(...workspace.findings);

		const target = await registry(manifest);
		const access = Preflight.#access(manifest);
		const tag = typeof manifest.publishConfig?.tag === 'string' ? manifest.publishConfig.tag : 'latest';
		// What the package itself declares, rather than npm's defaults
		const declared = ['registry', 'access', 'tag'].filter(key => manifest.publishConfig?.[key] !== undefined);
		const { files, excluded, omitted, bytes } = listing;
		return {
			protocol: Preflight.PROTOCOL,
			member: id,
			name: manifest.name,
			version: manifest.version,
			private: manifest.private === true,
			publication: { form: publication.form ?? null, ...(publication.protocol ? { protocol: publication.protocol } : {}), diagnostics: publication.diagnostics },
			registry: { url: target.url, source: target.source, access, tag, declared },
			files: { count: files.length, bytes, list: files, excluded, ...(omitted ? { omitted } : {}) },
			exports: surface,
			dependencies: workspace.dependencies,
			findings,
			ready: !findings.some(({ severity }) => severity === 'error')
		};
	}

	/**
	 * The fields npm itself would add to an archive, and the distribution manifest of a `distribution`
	 */
	#fields(manifest, included, publication, finding) {
		const relative = path => String(path).replace(/^\.\//, '');
		if (typeof manifest.main === 'string' && manifest.exports === undefined && !included.has(relative(manifest.main))) {
			finding('MAIN_EXCLUDED', 'warning', `"main" is "${manifest.main}", which the archive leaves out (npm would add it; this archive does not)`, [manifest.main]);
		}
		const bins = typeof manifest.bin === 'string' ? [manifest.bin] : Object.values(manifest.bin ?? {}).filter(value => typeof value === 'string');
		const missing = bins.filter(bin => !included.has(relative(bin)));
		missing.length && finding('BIN_EXCLUDED', 'warning', `"bin" names files the archive leaves out (npm would add them; this archive does not)`, missing);
		if (publication.form === 'distribution' && !included.has(relative(publication.manifest ?? 'beyond-distribution.json'))) {
			finding('DISTRIBUTION_MANIFEST_EXCLUDED', 'error', 'A "distribution" package must hold its beyond-distribution.json, which the archive leaves out');
		}
	}
}
