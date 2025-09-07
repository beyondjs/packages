import type { DynamicProcessorImplementation } from '@beyond-js/dynamic-processor/main';
import type { WatcherClient } from '@beyond-js/watchers/client';
import type { IDiagnostic } from '@beyond-js/packages/types';

// Package interface is duplicated here to avoid a circular dependency
// between @beyond-js/packages/package and @beyond-js/packages/modules
export interface Package extends DynamicProcessorImplementation {
	get path(): string;
	get name(): string;
	get version(): string;
	get vname(): string;
	get description(): string;
	get keywords(): string[];
	get license(): string;
	get watcher(): WatcherClient;
	get errors(): IDiagnostic[];
	get warnings(): IDiagnostic[];
	get valid(): boolean;
}
