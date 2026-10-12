import type { ITypesReference } from './references';

/**
 * Who provides the package a declaration belongs to, in the words of the composition document: a member of the
 * workspace, the toolchain (a supplied package, or the installation that runs Packages), an installation on this
 * machine found from the importer, or the store of an installed graph
 */
export type TypesProvider = 'workspace' | 'toolchain' | 'installation' | 'store';

/**
 * What `GET /types` answers (`beyond-types/1`): the declaration a consumer's type check reads for a public module,
 * with its provenance.
 *
 * - `provenance`: `generated` (Beyond's consolidated declaration of a workspace module), `package` (what an installed
 *   package declares through its `exports` types condition, `types`/`typings` or its files) or `types-package` (a
 *   reachable `@types` package).
 * - `form`: `declaration`, or `source` when what the type check reads is the TypeScript source a package publishes
 *   (a source-form package), which is shown as it is.
 * - `file`: the file relative to the package, for `package` and `types-package`; `vspecifier`: the versioned identity
 *   of a generated declaration, whose internal modules are named after it.
 * - `etag`: the hash of the generated declaration, or `sha256-<hex>` of the file read.
 * - `references`: the public specifiers the declaration imports, each with the importer to resolve it from.
 */
export interface ITypesDocument {
	protocol: 'beyond-types/1';
	specifier: string;
	importer?: string;
	provenance: 'generated' | 'package' | 'types-package';
	package: { name: string; version?: string; provider: TypesProvider };
	vspecifier?: string;
	file?: string;
	form: 'declaration' | 'source';
	text: string;
	etag: string;
	references: ITypesReference[];
}
