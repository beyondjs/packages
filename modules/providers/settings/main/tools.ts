export class TokenTools {
	static clean(value: string): string {
		return value.replace(/^"(.*)"$/, '$1').replace(/\\ /g, ' ');
	}
}
