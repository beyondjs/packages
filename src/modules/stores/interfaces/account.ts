interface IAccountData {
	id: string;
	organization: { name: string };
	plan: { type: 'free' | 'pro' | 'enterprise' };
	status: 'active' | 'suspended';
	timestamps: {
		created: number;
		updated?: number;
	};
}
