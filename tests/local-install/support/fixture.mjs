/**
 * What the acceptance workspace is made of (`fixtures/acceptance/README.md`), named once for every file that
 * installs it: its member ids in declaration order, the external releases its graph reaches, the node keys of its
 * members and the manifest the short edits change.
 */
import { Graph } from './graph.mjs';

export class Fixture {
	/**
	 * The member ids of the workspace, in declaration order (the root importer `.` is not a member)
	 */
	static MEMBERS = ['apps/app', 'apps/app18', 'packages/banner', 'packages/counter-view', 'packages/message', '../repositories/message-v2'];

	/**
	 * `name@version` of every external release the workspace's graph reaches, sorted
	 */
	static RELEASES = ['react-dom@18.3.1', 'react-dom@19.1.1', 'react@18.3.1', 'react@19.1.1', 'scheduler@0.23.2', 'scheduler@0.26.0', 'use-store@1.0.0'];

	/**
	 * The node keys of the members and of the root importer
	 */
	static KEYS = {
		app: Graph.member('apps/app'),
		app18: Graph.member('apps/app18'),
		banner: Graph.member('packages/banner'),
		view: Graph.member('packages/counter-view'),
		message: Graph.member('packages/message'),
		outside: Graph.member('../repositories/message-v2'),
		root: Graph.member('.')
	};

	/**
	 * The application manifest the short edits change, relative to the layout
	 */
	static MANIFEST = 'workspace/apps/app/package.json';
}
