import type { ICollection } from '@beyond-js/packages/persistence/types';
import type { IRepositoryAuthData } from '@beyond-js/packages/repositories/types';

export /*bundle*/ interface ICdnRepositoriesSettings {
	default: {
		host: string; // e.g., 'registry.mycompany.com' | 'registry.npmjs.org'
		auth: IRepositoryAuthData;
	};
	scopes: Record<string, string>; // e.g., {'@myorg': 'registry.mycompany.com', '@internal': 'registry.dev.com'}
	hosts: Record<string, IRepositoryAuthData>; // e.g., {'registry.mycompany.com': {mode: 'token', token: 'abcdef}}
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
	repositories: ICdnRepositoriesSettings;
}

export /*bundle*/ type Projects = ICollection<IProjectData>;
