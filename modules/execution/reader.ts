import type { ExecutionState, IExecutionCurrent, IExecutionDiagnostic, IExecutionDocument } from './types';
import { promises as fs } from 'fs';
import { join, resolve } from 'path';
import { Shape } from './shape';
import { Placement } from './placement';
import { Freshness } from './freshness';
import { Presence } from './presence';

/**
 * What reading a projection established
 */
export interface IReading {
	// Canonical root the projection was read for
	root: string;
	// The validated document, for the states that keep it: ready, stale and incomplete
	document?: IExecutionDocument;
	state: ExecutionState;
	diagnostics: IExecutionDiagnostic[];
}

/**
 * Reads the projection of a workspace root and decides its state: missing, incompatible (unreadable, of another
 * protocol or root, or locating a node where it may not be), or the document with what changed since it was
 * written (stale) and which nodes lost their sources (incomplete).
 */
export class Reader {
	static PATH = '.beyond/execution.json';

	static async read(given: string, current: IExecutionCurrent = {}): Promise<IReading> {
		const root = await fs.realpath(given).catch((): string => resolve(given));
		const path = join(root, ...Reader.PATH.split('/'));
		const refuse = (why: string, details?: Record<string, any>): IReading => {
			const code = 'EXECUTION_GRAPH_INCOMPATIBLE';
			const diagnostic: IExecutionDiagnostic = { code, message: `${why}: run beyond install`, severity: 'error' };
			return { root, state: 'incompatible', diagnostics: [details ? { ...diagnostic, details } : diagnostic] };
		};

		let text: string;
		try {
			text = await fs.readFile(path, 'utf8');
		} catch (error) {
			if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
				const message = `${root} has no execution projection (${Reader.PATH}): run beyond install`;
				const absent: IExecutionDiagnostic = { code: 'EXECUTION_GRAPH_MISSING', message, severity: 'warning' };
				return { root, state: 'missing', diagnostics: [absent] };
			}
			return refuse(`The execution projection ${path} could not be read (${error?.code || 'unknown error'})`);
		}

		let document: IExecutionDocument;
		try {
			document = Shape.check(JSON.parse(text), root);
		} catch (error) {
			return refuse(error instanceof SyntaxError ? `The projection ${path} is not valid JSON` : error.message);
		}
		const misplaced = Placement.check(document, current.locations);
		if (misplaced) return refuse(misplaced.message, misplaced.details);

		const diagnostics: IExecutionDiagnostic[] = [];
		const changes = await Freshness.changes(document, root, current.inputs);
		const changed = [...changes.keys()];
		if (changed.length) {
			const what = [...changes.values()].join(', ');
			const message = `The execution projection no longer matches ${what}: run beyond install`;
			diagnostics.push({ code: 'EXECUTION_GRAPH_STALE', message, severity: 'warning', details: { changed } });
		}

		const missing = await Presence.missing(document.nodes);
		for (const node of missing) {
			const message = `The sources of ${node} are not at ${document.nodes[node].location}: run beyond install`;
			diagnostics.push({ code: 'SOURCE_MISSING', message, severity: 'error', node });
		}

		const state: ExecutionState = missing.length ? 'incomplete' : changed.length ? 'stale' : 'ready';
		return { root, document, state, diagnostics };
	}
}
