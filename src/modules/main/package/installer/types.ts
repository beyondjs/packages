export interface ILocation {
	url: string;
	headers: Record<string, string>;
}

export interface ILocatorError {
	error: {
		code: string;
		text: string;
	};
}

export type ILocatorResult = ILocation | ILocatorError;

export type Source = 'npm' | 'github' | 'github-pkg' | 'gitlab' | 'artifactory' | 'url';

export interface IInfo {
	name: string;
	version: string;
	source: Source;
	ref?: string;
}
