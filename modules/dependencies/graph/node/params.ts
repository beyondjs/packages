import type { IProject } from '@beyond-js/packages/project/types';
import type { DependencyKind } from '@beyond-js/packages/dependencies/spec';
import type { Registry } from '../registry';
import type { IGraphLogger } from '../policy';
import type { Node } from '.';

export interface INodeDependency {
	kind: DependencyKind;
	package: string;
	version: string;
	// The version the dependent declares, when an override replaced it
	declared?: string;
	// A peer that may be absent
	optional?: boolean;
}

export interface INodeConstructorParams {
	project: IProject;
	registry: Registry;
	logger: IGraphLogger;
	dependency: INodeDependency;
	parent?: Node;
}
