export class TokenTools {
	/**
	 * Removes the quotes of a value and replaces `${NAME}` references with the given environment,
	 * as rc files are read by package managers
	 */
	static clean(value: string, env: Record<string, string | undefined> = {}): string {
		return value
			.trim()
			.replace(/^"(.*)"$/, '$1')
			.replace(/\\ /g, ' ')
			.replace(/\$\{([^}]+)\}/g, (_, name) => env[name] ?? '');
	}
}
