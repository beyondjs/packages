import type { IInstallationDiagnostic, IInstallationParams, IInstalledGraph } from './types';
import type { Settings } from './settings';
import { type IWorkspaceGraph, Resolution } from '@beyond-js/packages/resolution';

/**
 * What resolving the workspace established: the graph when it can be installed, the graph the resolver answered
 * whatever its diagnostics (what a plan compares), and every diagnostic of the resolution either way
 */
export interface IResolved {
	graph?: IInstalledGraph;
	document?: IWorkspaceGraph;
	diagnostics: IInstallationDiagnostic[];
}

/**
 * Resolves the whole workspace with the resolver of Packages (`Resolution.workspace`): every member and the
 * root's own dependencies, development dependencies of the importers included, with the previous lock (or the
 * preferences of a plan) as preferences. A graph with an error diagnostic is never installed.
 */
export class Resolving {
	#params: IInstallationParams;
	#settings: Settings;

	constructor(params: IInstallationParams, settings: Settings) {
		this.#params = params;
		this.#settings = settings;
	}

	/**
	 * A Beyond package no registry has is one the toolchain supplies before it is published: say how to get it
	 */
	#advised(code: string, message: string): string {
		if (code !== 'PACKAGE_NOT_FOUND' || !/"@beyond-js\//.test(message)) return message;
		const carried = this.#settings.toolchain
			? 'the archives of this Beyond command line do not carry it either'
			: 'it is supplied by the Beyond command line before it is published: run beyond install from an installation of the Beyond command line, or publish it to a registry this workspace uses';
		return `${message}: ${carried}`;
	}

	/**
	 * @param lock The content of the lock file in any format, or the preferences of a plan, offered as version
	 * preferences
	 * @param update Ignore the preferences
	 */
	async run(lock: any, update: boolean): Promise<IResolved> {
		const { manifest, members, logger } = this.#params;
		const graph: IWorkspaceGraph = await Resolution.workspace({
			root: { name: manifest?.name, manifest },
			members: members.map(({ id, name, version, path, manifest }) => ({ id, name, version, path, manifest })),
			lock,
			providers: await this.#settings.metadata(),
			update,
			development: true,
			logger
		});

		const diagnostics = (graph?.diagnostics || []).map(({ code, message, severity, node }) => {
			const diagnostic: IInstallationDiagnostic = {
				code,
				message: this.#advised(code, message),
				severity: severity === 'warning' ? 'warning' : 'error'
			};
			return node ? { ...diagnostic, node } : diagnostic;
		});
		if (graph?.protocol !== 'beyond-workspace-graph/1') {
			const message = 'The resolver did not answer a beyond-workspace-graph/1 document';
			return { diagnostics: [{ code: 'GRAPH_INCOMPLETE', message, severity: 'error' }, ...diagnostics] };
		}

		const errors = diagnostics.filter(({ severity }) => severity === 'error');
		if (!errors.length) return { graph, document: graph, diagnostics };

		const message = `The dependency graph of the workspace has ${errors.length} error(s): nothing was installed`;
		return { document: graph, diagnostics: [{ code: 'GRAPH_INCOMPLETE', message, severity: 'error' }, ...diagnostics] };
	}
}
