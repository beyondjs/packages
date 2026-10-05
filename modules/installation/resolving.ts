import type { IInstallationDiagnostic, IInstallationParams, IInstalledGraph } from './types';
import type { Settings } from './settings';
import { type IWorkspaceGraph, Resolution } from '@beyond-js/packages/resolution';

/**
 * What resolving the workspace established: the graph when it can be installed, and every diagnostic of the
 * resolution either way
 */
export interface IResolved {
	graph?: IInstalledGraph;
	diagnostics: IInstallationDiagnostic[];
}

/**
 * Resolves the whole workspace with the resolver of Packages (`Resolution.workspace`): every member and the
 * root's own dependencies, development dependencies of the importers included, with the previous lock as
 * preferences. A graph with an error diagnostic is never installed.
 */
export class Resolving {
	#params: IInstallationParams;
	#settings: Settings;

	constructor(params: IInstallationParams, settings: Settings) {
		this.#params = params;
		this.#settings = settings;
	}

	/**
	 * @param lock The content of the lock file in any format, offered as version preferences
	 * @param update Ignore the preferences of the lock
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
				message,
				severity: severity === 'warning' ? 'warning' : 'error'
			};
			return node ? { ...diagnostic, node } : diagnostic;
		});
		if (graph?.protocol !== 'beyond-workspace-graph/1') {
			const message = 'The resolver did not answer a beyond-workspace-graph/1 document';
			return { diagnostics: [{ code: 'GRAPH_INCOMPLETE', message, severity: 'error' }, ...diagnostics] };
		}

		const errors = diagnostics.filter(({ severity }) => severity === 'error');
		if (!errors.length) return { graph, diagnostics };

		const message = `The dependency graph of the workspace has ${errors.length} error(s): nothing was installed`;
		return { diagnostics: [{ code: 'GRAPH_INCOMPLETE', message, severity: 'error' }, ...diagnostics] };
	}
}
