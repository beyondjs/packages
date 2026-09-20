import type { IDiagnostic } from '@beyond-js/packages/types';

/**
 * How a package version was published, as its manifest declares it
 */
export /*bundle*/ interface IPublication {
	/**
	 * - `source`: Beyond sources, compiled by whoever consumes the package
	 * - `distribution`: outputs compiled before publication, listed by a distribution manifest
	 * - `npm`: an ordinary npm package, which declares nothing
	 *
	 * It is undefined when the declaration is invalid: the diagnostics say why, and nothing is guessed.
	 */
	form?: 'source' | 'distribution' | 'npm';

	version?: string;

	/**
	 * The protocol of the declaration, when the package carries one
	 */
	protocol?: string;

	/**
	 * `source`: the package-relative root of the public module sources, when the package names one
	 */
	modules?: string;

	/**
	 * `distribution`: what compiled it, the formats and conditions it holds and whether it ships source maps
	 */
	compiler?: { name: string; version: string };
	formats?: ('esm' | 'system')[];
	conditions?: string[];
	sourcemaps?: boolean;

	/**
	 * `distribution`: its distribution manifest, relative to the package root. The location is fixed by the
	 * layout, because the declaration has no member for it.
	 */
	manifest?: string;

	diagnostics: IDiagnostic[];
}

const MEMBERS = { source: ['protocol', 'form', 'modules'], distribution: ['protocol', 'form', 'compiler', 'formats', 'conditions', 'sourcemaps'] };

/**
 * The publication form of a package version.
 *
 * The discriminator is the manifest field `beyond.publication`, protocol `beyond-publication/1`:
 *
 * "beyond": { "publication": { "protocol": "beyond-publication/1", "form": "source" } }
 * "beyond": { "publication": { "protocol": "beyond-publication/1", "form": "distribution",
 *                              "compiler": { "name": "…", "version": "…" }, "formats": ["esm"] } }
 *
 * A manifest without the field is an ordinary npm package. File extensions, directory layouts and the
 * presence of built files are never consulted: a package that ships both sources and built files is what
 * its declaration says. A field that is present and cannot be read is an explicit diagnostic and selects no
 * form: it is never treated as an ordinary npm package, and a declaration that carries the members of both
 * forms is ambiguous. Reading a form never publishes anything; how a package reaches a registry is outside
 * this object.
 */
export /*bundle*/ class Publication {
	/**
	 * The protocol this implementation reads
	 */
	static get protocol() {
		return 'beyond-publication/1';
	}

	/**
	 * Where the distribution manifest of a `distribution` is, relative to the package root
	 */
	static get layout() {
		return './beyond-distribution.json';
	}

	/**
	 * Checks the members of a distribution declaration
	 */
	static #distribution(declared: Record<string, unknown>, label: string): IDiagnostic[] {
		const diagnostics: IDiagnostic[] = [];
		const fail = (code: string, message: string) => diagnostics.push({ code, message: `${label}: ${message}` });
		const { compiler, formats, conditions, sourcemaps } = <Record<string, any>>declared;

		const named = compiler && typeof compiler === 'object' && typeof compiler.name === 'string' && compiler.name;
		if (!named || typeof compiler.version !== 'string' || !compiler.version || Object.keys(compiler).length !== 2) {
			fail('PUBLICATION_COMPILER_INVALID', 'a "distribution" names what compiled it as "compiler": {"name", "version"}');
		}
		const known = formats instanceof Array && formats.length && formats.every(format => format === 'esm' || format === 'system');
		if (!known || new Set(formats).size !== formats.length) {
			fail('PUBLICATION_FORMATS_INVALID', 'a "distribution" lists the formats it holds as "formats": ["esm"], ["system"] or both');
		}
		const listed = conditions instanceof Array && conditions.every(one => typeof one === 'string' && one) && new Set(conditions).size === conditions.length;
		conditions !== void 0 && !listed && fail('PUBLICATION_CONDITIONS_INVALID', '"conditions" must be a list of distinct condition names');
		sourcemaps !== void 0 && typeof sourcemaps !== 'boolean' && fail('PUBLICATION_SOURCEMAPS_INVALID', '"sourcemaps" must be a boolean');
		return diagnostics;
	}

	/**
	 * @param manifest The parsed `package.json` of the package version
	 */
	static read(manifest: unknown): IPublication {
		const diagnostics: IDiagnostic[] = [];
		const fail = (code: string, message: string, partial: Partial<IPublication> = {}): IPublication => {
			diagnostics.push({ code, message });
			return Object.assign({ diagnostics }, partial);
		};

		if (!manifest || typeof manifest !== 'object' || manifest instanceof Array) {
			return fail('MANIFEST_INVALID', 'The package manifest must be an object');
		}

		const { name, version, beyond } = <Record<string, any>>manifest;
		const label = typeof name === 'string' && name ? `Package "${name}"` : 'The package';
		if (typeof name !== 'string' || !name) diagnostics.push({ code: 'PACKAGE_NAME_MISSING', message: 'The package does not declare its name' });
		if (typeof version !== 'string' || !version) {
			diagnostics.push({ code: 'PACKAGE_VERSION_MISSING', message: `${label} does not declare its version` });
		}

		const declared = beyond && typeof beyond === 'object' ? beyond.publication : void 0;
		if (declared === void 0) return { form: diagnostics.length ? void 0 : 'npm', version, diagnostics };

		if (!declared || typeof declared !== 'object' || declared instanceof Array) {
			return fail('PUBLICATION_INVALID', `${label}: "beyond.publication" must be an object with "protocol" and "form"`, { version });
		}

		const { protocol, form } = <Record<string, unknown>>declared;
		if (typeof protocol !== 'string' || !protocol) {
			return fail('PUBLICATION_PROTOCOL_MISSING', `${label}: "beyond.publication.protocol" is required`, { version });
		}
		if (protocol !== Publication.protocol) {
			const message = `${label} declares the publication protocol "${protocol}"; this implementation reads "${Publication.protocol}"`;
			return fail('PUBLICATION_PROTOCOL_UNKNOWN', message, { version, protocol });
		}
		if (form !== 'source' && form !== 'distribution') {
			const message = `${label}: "beyond.publication.form" must be "source" or "distribution" (found: ${JSON.stringify(form)})`;
			return fail('PUBLICATION_FORM_INVALID', message, { version, protocol });
		}

		// The members of one form are rejected in the other, so a declaration cannot describe both
		const other = form === 'source' ? 'distribution' : 'source';
		const foreign = Object.keys(declared).filter(member => !MEMBERS[form].includes(member));
		const ambiguous = foreign.filter(member => MEMBERS[other].includes(member));
		if (ambiguous.length) {
			const message = `${label} declares the "${form}" form together with members of the "${other}" form (${ambiguous.join(', ')}). Declare one form`;
			return fail('PUBLICATION_AMBIGUOUS', message, { version, protocol });
		}
		if (foreign.length) {
			return fail('PUBLICATION_MEMBER_UNKNOWN', `${label}: "beyond.publication" does not define ${foreign.join(', ')}`, { version, protocol });
		}

		const { modules, compiler, formats, conditions, sourcemaps } = <Record<string, any>>declared;
		if (form === 'source') {
			const invalid = modules !== void 0 && (typeof modules !== 'string' || !modules || modules.split('/').includes('..'));
			if (invalid) return fail('PUBLICATION_MODULES_INVALID', `${label}: "modules" is the package-relative root of the module sources`, { version, protocol });
			return diagnostics.length ? { version, protocol, diagnostics } : { form, version, protocol, modules, diagnostics };
		}

		diagnostics.push(...Publication.#distribution(declared, label));
		if (diagnostics.length) return { version, protocol, diagnostics };
		return { form, version, protocol, compiler, formats, conditions, sourcemaps, manifest: Publication.layout, diagnostics };
	}
}
