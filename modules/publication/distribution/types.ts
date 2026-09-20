/**
 * The conditions a variant of a distribution was compiled for
 */
export /*bundle*/ interface IVariantConditions {
	platform: string;
	environment?: string;
}

/**
 * One prebuilt file of a distribution
 */
export /*bundle*/ interface IDistributedFile {
	kind: 'js' | 'css' | 'map' | 'asset';

	/**
	 * The file, relative to the package root
	 */
	file: string;

	media: string;

	/**
	 * `sha256-<base64>` of the file, which the reader verifies before returning it
	 */
	digest: string;

	bytes: number;

	/**
	 * Which output of the same variant a source map describes: `js` or `css`
	 */
	of?: 'js' | 'css';
}

/**
 * The outputs of one public module for one set of conditions and one format
 */
export /*bundle*/ interface IVariant {
	conditions: IVariantConditions;
	format: 'esm' | 'system';
	outputs: IDistributedFile[];
}

/**
 * A public reference of a distributed module. `eager` is a static import, `lazy` a dynamic one, `style` a
 * stylesheet public module the module requires.
 */
export /*bundle*/ interface IDistributedReference {
	specifier: string;
	kind: 'eager' | 'lazy' | 'style';
}

export /*bundle*/ interface IDistributedModule {
	kind: 'module' | 'style';
	references: IDistributedReference[];

	/**
	 * The declared assets the module uses, as paths relative to the package root
	 */
	assets: string[];

	variants: IVariant[];
}

/**
 * The manifest of a precompiled distribution, `beyond-distribution/1`.
 *
 * It lists, per public module, conditions and format, the prebuilt files with their digests, and the public
 * references and assets of every module, so a reader can trace and deliver the package without compiling
 * or parsing anything.
 */
export /*bundle*/ interface IDistributionManifest {
	protocol: 'beyond-distribution/1';
	package: { name: string; version: string };

	/**
	 * What compiled the distribution, as its generation reported it
	 */
	compiler?: { name: string; version: string };

	modules: Record<string, IDistributedModule>;
	assets: Record<string, Omit<IDistributedFile, 'kind' | 'of'>>;
}
