import type { ICollection } from '@beyond-js/packages/persistence/types';
import type { IProviderAuthData } from '@beyond-js/packages/providers/types';

export /*bundle*/ interface ICdnProvidersSettings {
	default: {
		host: string; // e.g., 'registry.mycompany.com' | 'registry.npmjs.org'
		auth: IProviderAuthData;
	};
	scopes: Record<string, string>; // e.g., {'@myorg': 'registry.mycompany.com', '@internal': 'registry.dev.com'}
	hosts: Record<string, IProviderAuthData>; // e.g., {'registry.mycompany.com': {mode: 'token', token: 'abcdef}}
}

export /*bundle*/ interface IProjectData {
	id: string;
	account: { id: string; organization: { name: string } };
	name: string;
	visibility: { private: boolean };
	timestamps: {
		created: { at: number };
		updated?: { at: number };
		deleted?: { at: number };
	};
	providers: ICdnProvidersSettings;
}

export /*bundle*/ type Projects = ICollection<IProjectData>;
