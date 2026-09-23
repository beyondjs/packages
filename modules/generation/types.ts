import type { IDiagnostic } from '@beyond-js/packages/types';
import { type IGraph, type SourcesType, type IAnalysisConditions, type IItem, type IKeyInputs } from '@beyond-js/packages/analysis';

export /*bundle*/ type FormatType = 'esm' | 'system';

export /*bundle*/ interface IGenerationRequest {
	/**
	 * One item of an inventory. Its `kind`, `package` and `subpath` say what to generate (the subpath of an
	 * asset is its path in the package), and the resolution its `inputs` recorded is followed as it is.
	 * Everything else is established again from the sources.
	 */
	item: Pick<IItem, 'kind' | 'package' | 'subpath'> & Partial<IItem>;

	graph: IGraph;
	sources: SourcesType;
	conditions: IAnalysisConditions;
	format: FormatType;

	/**
	 * The compiler, selected as in the esbuild bundler: a package name, a `file:` URL, an absolute path or
	 * `env:NAME`. There is no default.
	 */
	compiler: string;
}

/**
 * How an output relates to the rest of what the application loads
 */
export /*bundle*/ interface IRelations {
	/**
	 * The output of the same unit a source map describes
	 */
	of?: 'js' | 'css';

	/**
	 * The public modules the code references, as bare specifiers it still contains, with the node of the
	 * graph that satisfies each one and its subpath as the inventory writes it. A `style` reference is a
	 * stylesheet the code selected (`pkg/sub.css`), removed from the code: it names the CSS output of the
	 * public module `subpath`, and whoever delivers the module links it.
	 */
	references?: { specifier: string; kind: 'eager' | 'lazy' | 'style'; package?: string; subpath?: string; builtin?: boolean }[];

	/**
	 * Whether the unit also produced the stylesheet of the module
	 */
	stylesheet?: boolean;

	/**
	 * The static files the output addresses as `../assets/<path>`, by their path inside the package
	 */
	assets?: { package: string; path: string }[];

	/**
	 * The code of a widget: it adopts its stylesheets, and the ones its non-widget dependencies select, inside
	 * a root of its own, so a document does not link them
	 */
	widget?: boolean;

	/**
	 * The shared stylesheet of the package of a widget, its `./global` style module, which the widget adopts in
	 * its root before its own sheets. The inventory holds it as a `style` item the widget reaches.
	 */
	global?: { package: string; subpath: string };
}

export /*bundle*/ interface IOutput {
	kind: 'js' | 'css' | 'map' | 'asset';
	media: string;

	/**
	 * The text of a `js`, `css` or `map` output
	 */
	code?: string;

	/**
	 * The bytes of an `asset`
	 */
	bytes?: Uint8Array;

	size: number;

	/**
	 * `sha256-<base64>` of the content
	 */
	digest: string;

	/**
	 * The compatibility key of this output: the key of the inventory item it satisfies. A source map carries
	 * the key of the output it describes.
	 */
	key: string;

	relations: IRelations;
}

export /*bundle*/ interface IProvenance {
	/**
	 * What produced the outputs: the compiler (name, version, fork capability and revision), the options it
	 * ran with and the transformation of a `system` output. Where the compiler is installed and how it was
	 * selected are not reported: nothing in a provenance depends on the machine that produced it. A
	 * distribution reports what its declaration says compiled it and `distributed: true`; a static file
	 * reports `copied: true`.
	 */
	compiler: Record<string, unknown>;

	/**
	 * The source files that were read, under the virtual root of their package
	 * (`beyond://<package>@<version>/<path>`), or the prebuilt files of a distribution
	 */
	files: string[];

	/**
	 * The inputs of the compatibility key of the main output, exactly as they were hashed
	 */
	inputs: IKeyInputs;

	/**
	 * The compatibility key of the main output of the unit
	 */
	key: string;

	ms: number;
}

export /*bundle*/ interface IGenerated {
	outputs: IOutput[];

	/**
	 * Every reason the unit did not produce its outputs. Build errors are always here: they are never
	 * withheld, whatever the caller is entitled to.
	 */
	diagnostics: IDiagnostic[];

	warnings: IDiagnostic[];
	provenance?: IProvenance;
}
