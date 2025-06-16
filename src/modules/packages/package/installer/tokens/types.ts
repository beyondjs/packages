export interface TokenResolver {
	resolve(
		project: string,
		source: string,
		domain?: string
	): Promise<string | { user?: string; token: string } | undefined>;
}
