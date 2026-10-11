/**
 * Takes the locations of this machine out of a text that a visitor of the preview reads: the diagnostics and reasons
 * of the preview description and of the composition document, which the preview listener serves to any page.
 *
 * An absolute filesystem path, a `file:` address and a Windows path are cut to their last segment (`…/index.ts`),
 * which is what a message needs to stay useful; addresses of this environment (relative, `../m/…`) and of the CDN
 * (`https://…`) are left as they are, since they are what the page loads.
 */
export class Redaction {
	static #FILE = /file:\/\/[^\s"'`)\]]+/g;
	static #POSIX = /(^|[\s"'`(\[=,])\/(?!\/)[^\s"'`)\]]*\/([^\s"'`)\]/,:;]+)/g;
	static #WINDOWS = /\b[A-Za-z]:\\(?:[^\s"'`)\]\\]+\\)*([^\s"'`)\]\\]+)/g;

	static text(value: string): string {
		if (typeof value !== 'string') return value;
		return value
			.replace(Redaction.#FILE, address => `…/${address.split('/').pop()}`)
			.replace(Redaction.#POSIX, (_, before: string, last: string) => `${before}…/${last}`)
			.replace(Redaction.#WINDOWS, (_, last: string) => `…\\${last}`);
	}
}
