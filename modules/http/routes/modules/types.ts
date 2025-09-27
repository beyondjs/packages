export type TargetType = 'browser' | 'node';
export type FormatType = 'esm' | 'cjs' | 'system';
export type EnvironmentType = 'production' | 'development';
export type SourceMapType = 'external' | 'inline' | 'none';

export interface IPackageIdentifier {
	rid: string; // Registry identifier
	scope?: string;
	name: string;
	version: string;
}

export interface IGitIdentifier {
	host: string;
	owner: string;
	repo: string;
	commit: string;
}
