import { createHash } from 'crypto';

/**
 * The content digest of an output or a source: `sha256-<base64>`, the spelling npm and browsers use for
 * integrity values. It identifies bytes; it is not the compatibility key, which identifies the inputs that
 * produce them.
 */
export /*bundle*/ class Digest {
	/**
	 * @param content The exact bytes, or the text encoded as UTF-8
	 */
	static of(content: string | Uint8Array): string {
		return `sha256-${createHash('sha256').update(content).digest('base64')}`;
	}
}
