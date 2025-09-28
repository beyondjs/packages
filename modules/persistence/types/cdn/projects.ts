import type { ICollection } from '@beyond-js/packages/persistence/types';
import type { IProviderData } from '@beyond-js/packages/providers/settings/types';

export /*bundle*/ interface ICdnProvidersSettings {
	default?: IProviderData;
	scopes?: Record<string, IProviderData>;
	hosts?: Record<string, IProviderData>;
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
