import type { IDiagnostic } from '@beyond-js/packages/types';
import type { IArtifactDependency } from './types';

/**
 * Which module of which exact package version is requested
 */
export /*bundle*/ interface IDeliveryRequest {
	name: string;
	version: string;
	subpath: string;
}

/**
 * Why a module cannot be delivered. The codes are those of the compiled-module contract.
 */
export /*bundle*/ interface IDeliveryFailure {
	code: 'PACKAGE_NOT_FOUND' | 'VERSION_MISMATCH' | 'MODULE_NOT_FOUND' | 'BUILD_FAILED' | 'OUTPUT_NOT_AVAILABLE';
	message: string;
	diagnostics?: IDiagnostic[];

	/**
	 * The hash of the stylesheet of a style module, whose code is the output that is not available: the module
	 * built, and its stylesheet is served as a companion
	 */
	styles?: string;
}

/**
 * The public declaration of a module, as one ambient module declaration
 */
export /*bundle*/ interface IDeclaration {
	vspecifier: string;
	hash: string;
	code: string;
}

export /*bundle*/ interface IDelivered {
	vspecifier: string;
	hash: string;

	/**
	 * The conditional that satisfied the request: `web`, or `web/production` for a module that declares a
	 * production build. A request for production is answered only by a production conditional.
	 */
	key: string;

	/**
	 * How each public dependency of the output is satisfied, which is what lets a caller follow the graph
	 * of workspace modules behind an entry point
	 */
	dependencies: IArtifactDependency[];

	/**
	 * The runtime public module that a composed artifact imports, which is not one of the dependencies of
	 * its sources. A packaged artifact imports none.
	 */
	runtime?: string;

	/**
	 * The hash of the stylesheet of the module, when its sources produce one. It changes with the
	 * stylesheet alone, so a consumer replaces the stylesheet of a module whose code did not change.
	 */
	styles?: string;

	/**
	 * The stylesheets the sources select by specifier (`pkg/sub.css`). They are not in the code: a document
	 * links them, and the runtime adopts them with the styles of a composed module
	 */
	stylesheets?: string[];

	/**
	 * The registration of the widget the module declares, when it is one
	 */
	widget?: { name: string; vspecifier: string; attrs?: string[]; render: { csr: boolean; ssr: boolean; sr: boolean } };
	code: (sourcemap: 'inline' | 'none') => string;

	/**
	 * The update of an already loaded module, which carries its source map inline. A packaged module has
	 * none: there is nothing to patch in place, so the value is undefined.
	 */
	patch: () => string | undefined;
}

/**
 * One public module of the workspace, as a development session describes it
 */
export /*bundle*/ interface IPublished {
	specifier: string;
	vspecifier: string;
	name: string;
	version: string;
	subpath: string;

	/**
	 * The directory of the package, where the installed dependencies of its modules are resolved from
	 */
	path: string;

	/**
	 * Whether the package is one the toolchain supplies to every workspace, rather than one of the workspace
	 */
	supplied?: boolean;

	/**
	 * With the execution projection of an installed graph: the key of the node the package is in it
	 * (`workspace:<member id>`), which tells two versions of one name apart
	 */
	node?: string;
}
