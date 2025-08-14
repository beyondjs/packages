import type { IRepositoryAuth } from '@beyond-js/packages/repositories/types';

export /*bundle*/ interface IRepositoriesSettings {
	// Scopes to registry mapping: the key is the scope and the value is the repository host
	get scopes(): Map<string, string>;

	// The hosts map: the key is the host and the value is the repository auth type
	get hosts(): Map<string, IRepositoryAuth>;

	// The default repository host
	get default(): { host: string; auth?: IRepositoryAuth };
}
