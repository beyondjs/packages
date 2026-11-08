/**
 * The envelope of an internal module in an artifact: the creator function its code is the body of, registered under
 * its id and its hash.
 *
 * The runtime calls the creator with `require`, the `exports` object it fills and, where it applies updates, the update
 * API of the source (`import.meta.hot`). A source that writes `import.meta` reads it as `__beyond_meta`, the name the
 * transpilation of the `ts` bundler gives it (its `Meta`): the envelope declares it as the artifact's `import.meta`
 * with that `hot`, undefined where the runtime gives none (the legacy Kernel). The declaration is written on the line
 * that opens the creator, so the lines of the source keep their map.
 */
export class Envelope {
	static NAME = '__beyond_meta';

	/**
	 * The line that opens the creator of an internal module, with the code that follows it
	 */
	static open(id: string, hash: number, code: string): string {
		const name = Envelope.NAME;
		const meta = code.includes(name) ? ` ${name} = Object.create(import.meta, { hot: { value: ${name}, enumerable: true } });` : '';
		return `__ims.set('${id}', { hash: ${hash}, creator: function (require, exports, ${name}) {${meta}`;
	}

	/**
	 * The line that closes it
	 */
	static close(): string {
		return '}});';
	}
}
