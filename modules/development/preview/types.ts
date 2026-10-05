export /*bundle*/ interface IPreviewModule {
	specifier: string;

	/**
	 * `environment`: selected for development and served by this service, an installed package this environment
	 * compiles for browsers, or any node of an installed graph. `cdn`: every other module, at its exact version.
	 * `unresolved`: a module that no address could be given to, with the reason.
	 */
	source: 'environment' | 'cdn' | 'unresolved';
	version?: string;

	/**
	 * The versioned identity of a module served by this environment, which builds and the runtime name it by
	 */
	vspecifier?: string;
	url?: string;
	reason?: string;

	/**
	 * The address of the stylesheet of the module, when its sources produce one and it is served by this
	 * environment. The document links the stylesheets of the modules that are not widgets; a widget adopts
	 * its own sheets inside its shadow root.
	 */
	styles?: string;

	/**
	 * Whether the module declares a widget
	 */
	widget?: boolean;

	/**
	 * The stylesheets the sources of the module select by specifier (`pkg/sub.css`): the stylesheet of the
	 * public module `pkg/sub`, with its address and the versioned identity the runtime replaces it by. The
	 * document links those of the modules in its scope; a widget adopts them.
	 */
	stylesheets?: { specifier: string; vspecifier: string; url: string }[];

	/**
	 * Who holds the stylesheets of a module that has them: the document, when the entry reaches the module
	 * without crossing a widget, or the widgets that import it, which adopt them in their own roots
	 */
	scope?: 'document' | 'widget';
}

/**
 * A module in development as the development runtime needs to know it to apply its updates
 */
export /*bundle*/ interface IPreviewUpdatable {
	package: string;
	vspecifier: string;
	path: string;
}

export /*bundle*/ interface IPreviewDiagnostic {
	code: string;
	message: string;
}
