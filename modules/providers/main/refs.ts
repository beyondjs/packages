/**
 * The references a git host advertises through the smart-HTTP protocol (`info/refs?service=git-upload-pack`):
 * a sequence of pkt-lines, each `<4 hex length><commit> <reference>[\0<capabilities>]\n`, with flush packets
 * (`0000`) between sections. Only the version 0/1 advertisement is read: it is what a host answers a request
 * that does not ask for protocol version 2.
 */
export class GitReferences {
	#references: Map<string, string> = new Map();

	get size() {
		return this.#references.size;
	}

	/**
	 * @param advertisement The body of the response
	 */
	constructor(advertisement: string) {
		// Lengths count bytes, not characters
		const bytes = Buffer.from(advertisement, 'utf8');
		let position = 0;
		while (position + 4 <= bytes.length) {
			const length = parseInt(bytes.toString('latin1', position, position + 4), 16);
			if (Number.isNaN(length)) break;
			if (length === 0) {
				position += 4;
				continue;
			}
			if (length < 4) break;

			const line = bytes.toString('utf8', position + 4, position + length).replace(/\n$/, '');
			position += length;

			// `# service=…` opens the advertisement; every other line names one reference
			const [reference] = line.split('\0');
			const match = /^([0-9a-f]{40}) (.+)$/.exec(reference);
			match && !this.#references.has(match[2]) && this.#references.set(match[2], match[1]);
		}
	}

	/**
	 * The commit a reference points to. The default branch when there is none; otherwise a full reference
	 * name, then a tag (the commit an annotated tag points to), then a branch, as git reads a short name.
	 */
	commit(reference?: string): string | undefined {
		if (!reference) return this.#references.get('HEAD');

		const candidates = reference.startsWith('refs/')
			? [`${reference}^{}`, reference]
			: [`refs/tags/${reference}^{}`, `refs/tags/${reference}`, `refs/heads/${reference}`];
		for (const candidate of candidates) {
			if (this.#references.has(candidate)) return this.#references.get(candidate);
		}
	}
}
