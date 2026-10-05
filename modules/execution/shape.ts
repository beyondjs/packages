import type { IExecutionDocument } from './types';
import { isAbsolute, resolve } from 'path';

/**
 * Why a projection cannot be used. `Execution.from` throws it; `Execution.read` reports it as the state
 * `incompatible` with the diagnostic `EXECUTION_GRAPH_INCOMPATIBLE`.
 */
export class Incompatible extends Error {
	readonly code = 'EXECUTION_GRAPH_INCOMPATIBLE';
}

const object = (value: any) => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: any) => typeof value === 'string' && !!value;
const absolute = (value: any) => text(value) && isAbsolute(value);
const named = (value: any) => object(value) && text(value.name) && text(value.version);

/**
 * Checks that a parsed document is a `beyond-execution/1` projection of the given root whose edges, members
 * and contexts only name nodes it holds, so that the indexes built over it never answer a dangling key. Where
 * the nodes are located is checked by `Placement`, when a projection is read from disk.
 */
export class Shape {
	static check(data: any, root: string): IExecutionDocument {
		const refuse = (why: string) => {
			throw new Incompatible(`The execution projection ${why}`);
		};

		if (!object(data)) refuse('is not a JSON object');
		const { protocol } = data;
		if (protocol !== 'beyond-execution/1') refuse(`has the protocol "${protocol}", not beyond-execution/1`);
		if (!absolute(data.root)) refuse('does not name the absolute root it was written for');
		if (resolve(data.root) !== resolve(root)) refuse(`was written for another root (${data.root})`);
		if (!text(data.lock)) refuse('does not name the lock it was built from');
		if (!object(data.inputs)) refuse('does not record its inputs');
		if (!absolute(data.store)) refuse('does not name its absolute store root');
		if (!object(data.nodes)) refuse('has no nodes');
		if (!object(data.members)) refuse('has no members');
		if (!Array.isArray(data.edges)) refuse('has no edges');

		for (const [key, node] of Object.entries<any>(data.nodes)) {
			if (!named(node)) refuse(`node "${key}" has no name or version`);
			if (!absolute(node.location)) refuse(`node "${key}" has no absolute location`);
		}
		for (const [id, member] of Object.entries<any>(data.members)) {
			if (!named(member)) refuse(`member "${id}" is invalid`);
			if (!absolute(member.location)) refuse(`member "${id}" has no absolute location`);
			if (member.node !== `workspace:${id}`) refuse(`member "${id}" names "${member.node}", not workspace:${id}`);
			if (!data.nodes[member.node]) refuse(`member "${id}" names the unknown node "${member.node}"`);
		}

		const known = (key: any) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(data.nodes, key);
		data.edges.forEach((edge: any, index: number) => {
			if (!object(edge) || !known(edge.from)) refuse(`edge ${index} has an unknown dependent`);
			if (edge.to !== null && !known(edge.to)) refuse(`edge ${index} reaches the unknown node "${edge.to}"`);
			if (edge.to === null && !text(edge.name)) refuse(`edge ${index} has neither a target nor a name`);
			if (edge.name !== void 0 && !text(edge.name)) refuse(`edge ${index} has an invalid name`);
			if (edge.context !== void 0 && !known(edge.context))
				refuse(`edge ${index} has a context that names no node`);
		});
		return data;
	}
}
