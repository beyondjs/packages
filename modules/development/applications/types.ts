/**
 * A finding about the declaration of applications (`beyond-applications/1`). An `error` keeps the application or
 * target it belongs to from being resolved or launched; a `warning` does not. `field` names the declared field it is
 * about, when it is about one.
 */
export interface IApplicationsDiagnostic {
	code: string;
	message: string;
	severity: 'error' | 'warning';
	field?: string;
}

/**
 * The document that owns the declaration: `beyond.json` when the `applications` branch is inline (or absent), the
 * file the branch names when it is file-backed. `path` is relative to the served root, `revision` the File API's
 * revision of it when it exists, which is what a write states with `If-Match`; `reference` is the branch as
 * `beyond.json` writes it, for a file-backed one.
 */
export interface IApplicationsDocument {
	path: string;
	branch: 'inline' | 'file';
	exists: boolean;
	revision?: string;
	reference?: string;
}

/**
 * An execution target as the catalog lists it: what was declared, the public specifier of its entry and the
 * environment its consumer runs in, when they can be told, and its diagnostics. A value of a field that does not
 * have the type the field needs is not listed; its diagnostic says why.
 */
export interface ICatalogTarget {
	id: string;
	title?: string;
	kind?: string;
	package?: string;
	entry?: string;
	specifier?: string;
	environment?: 'browser' | 'node' | 'deno';
	conditions?: string[];
	selection?: string;
	runtime?: string;
	readiness?: { output: string };
	diagnostics: IApplicationsDiagnostic[];
}

/**
 * An application as the catalog lists it, with its targets in the order they are declared
 */
export interface ICatalogApplication {
	id: string;
	title?: string;
	targets: ICatalogTarget[];
	diagnostics: IApplicationsDiagnostic[];
}

/**
 * How the service follows the declaration now, which is state of the service and not of the declaration, so it is no
 * part of the generation: `live` when a change reaches the catalog and `applications.changed` without a request,
 * through the watchers service (`watchers: ready`) or the File API's events of the documents (`events`); `reason` says
 * why the watchers service does not follow it, when it does not
 */
export interface IApplicationsFollowing {
	live: boolean;
	watchers: 'starting' | 'ready' | 'unavailable';
	events: boolean;
	reason?: string;
}

/**
 * The catalog document (`GET /applications`): the applications and execution targets declared in the served
 * workspace, the document that owns them and the generation of the catalog, which grows every time the catalog
 * processed a change of what it is read from, and how the service follows the declaration
 */
export interface IApplicationsCatalog {
	protocol: 'beyond-applications/1';
	generation: number;
	document: IApplicationsDocument;
	following: IApplicationsFollowing;
	applications: ICatalogApplication[];
	diagnostics: IApplicationsDiagnostic[];
}

/**
 * Where the composition of a target's graph comes from, counted by source: `workspace`, `environment`, `cdn`,
 * `unresolved` and, for a package whose modules come from more than one, `mixed`
 */
export interface ICompositionSummary {
	packages: Record<string, number>;
	modules: Record<string, number>;
	reason?: string;
}

/**
 * A target resolved by the Core (`GET /applications/:application/targets/:target`): the declared target, the entry
 * module found in the workspace, whether it builds for its environment (`pending` while it is still being built once
 * the bound of the resolution passed), the composition of its graph by source, and how it starts: the preview document
 * of a frontend target, whether a backend one can be launched and the specifier a launch imports
 */
export interface IResolvedTarget {
	protocol: 'beyond-applications/1';
	generation: number;
	application: { id: string; title?: string };
	declared: ICatalogTarget;
	entry: {
		specifier?: string;
		vspecifier?: string;
		package?: { name: string; version: string; source: 'workspace' | 'toolchain'; selected: boolean };
	};
	environment?: 'browser' | 'node' | 'deno';
	build?: { platform: 'web' | 'node'; state: 'built' | 'failed' | 'unsupported' | 'pending'; hash?: string };
	composition?: ICompositionSummary;
	open?: { preview: string };
	launch?: { supported: boolean; reason?: string; requires?: string; specifier?: string };
	diagnostics: IApplicationsDiagnostic[];
}
