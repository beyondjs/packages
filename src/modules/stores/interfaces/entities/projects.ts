export /*bundle*/ interface ITokenData {
	source: { type: 'npm' | 'github' | 'gitlab' | 'artifactory'; domain?: string };
	credentials: { token: string; user?: string };
	timestamps: {
		created: { at: number };
	};
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
	tokens: ITokenData[];
}
