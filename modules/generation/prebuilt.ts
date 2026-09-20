import type { IDiagnostic } from '@beyond-js/packages/types';
import { type Distribution } from '@beyond-js/packages/publication';
import { Keyed, Toolchain, type Opened, type IPublicModule, type IAnalysisConditions, type IKeyInputs } from '@beyond-js/packages/analysis';
import { promises as fs } from 'fs';
import { join, normalize, sep } from 'path';
import type { FormatType, IGenerated } from './types';
import { Outputs } from './outputs';

/**
 * The units that are read instead of compiled: the prebuilt outputs of a distribution, and static files.
 *
 * A distribution answers with the files its manifest lists, verified against their digests. No compiler
 * runs, so the selected one is not part of their identity: their key names what the declaration of the
 * distribution says compiled it.
 */
export /*bundle*/ class Prebuilt {
	#opened: Opened;
	#conditions: IAnalysisConditions;
	#format: FormatType;

	constructor(opened: Opened, conditions: IAnalysisConditions, format: FormatType) {
		this.#opened = opened;
		this.#conditions = conditions;
		this.#format = format;
	}

	#missing(): IGenerated {
		const message = `Package "${this.#opened.key}" has no integrity: its node has none and its sources were given without the one its fetch verified`;
		return { outputs: [], diagnostics: [{ code: 'INTEGRITY_MISSING', message }], warnings: [] };
	}

	/**
	 * The prebuilt outputs of a distributed module
	 *
	 * @param resolution Which node satisfies each package the module references
	 * @param only Restricts the outputs to the stylesheet of the module
	 */
	async module(distribution: Distribution, module: IPublicModule, resolution: Record<string, string>, only?: 'css'): Promise<IGenerated> {
		const started = Date.now();
		const warnings: IDiagnostic[] = [];
		const read = await distribution.outputs({ subpath: module.subpath, conditions: this.#conditions, format: this.#format });
		if (read.diagnostics.length) return { outputs: [], diagnostics: read.diagnostics, warnings };

		const described = new Toolchain(void 0, this.#conditions, this.#format).describe(this.#opened);
		const shared = Keyed.inputs(this.#opened, module.subpath, resolution, described, 'js');
		if (!shared) return this.#missing();
		const outputs = new Outputs(shared);

		const references = module.distributed.references.map(({ specifier, kind }) => ({ specifier, kind }));
		const assets = module.distributed.assets.map(path => ({ package: this.#opened.key, path }));
		const stylesheet = read.outputs.some(({ kind }) => kind === 'css');
		read.outputs.forEach(({ kind, content, of }) => {
			if (kind === 'asset' || (only && kind !== 'css' && of !== 'css')) return;
			const relations = kind === 'map' ? { of: of ?? <const>'js' } : kind === 'js' ? { references, stylesheet, assets } : { assets };
			outputs.text(kind, content.toString('utf8'), relations);
		});

		const main: IKeyInputs['output'] = module.kind === 'style' || only ? 'css' : 'js';
		const compiler = Object.assign({ distributed: true }, distribution.manifest.compiler);
		const provenance = { compiler, files: read.outputs.map(({ file }) => file), inputs: outputs.inputs(main), key: outputs.key(main), ms: Date.now() - started };
		return { outputs: outputs.list, diagnostics: [], warnings, provenance };
	}

	/**
	 * A static file of the package, by its path inside it
	 */
	async asset(path: string, distribution?: Distribution): Promise<IGenerated> {
		const started = Date.now();
		const warnings: IDiagnostic[] = [];
		const fail = (code: string, message: string): IGenerated => ({ outputs: [], diagnostics: [{ code, message }], warnings });
		const { key, root } = this.#opened;

		const file = normalize(join(root, path));
		if (typeof path !== 'string' || !file.startsWith(root + sep)) return fail('ASSET_OUTSIDE_PACKAGE', `Asset "${path}" of "${key}" is outside the package`);

		let bytes: Uint8Array;
		let media: string;
		const listed = await distribution?.asset(path);
		if (listed?.output) ({ content: bytes, media } = listed.output);
		// A file the distribution lists must match its digest; any other file of the package is read as it is
		else if (listed && (await this.#opened.listed(path))) return { outputs: [], diagnostics: listed.diagnostics, warnings };
		else bytes = await fs.readFile(file).catch(() => void 0);
		if (!bytes) return fail('ASSET_NOT_FOUND', `Asset "${path}" does not exist in package "${key}"`);

		const shared = Keyed.inputs(this.#opened, path, {}, Toolchain.copied, 'asset');
		if (!shared) return this.#missing();
		const outputs = new Outputs(shared);
		outputs.asset(path, bytes, media);
		const provenance = { compiler: { copied: true }, files: [path], inputs: outputs.inputs('asset'), key: outputs.key('asset'), ms: Date.now() - started };
		return { outputs: outputs.list, diagnostics: [], warnings, provenance };
	}
}
