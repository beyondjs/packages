import { Stacks } from '../../stacks/index.mjs';

/**
 * Why a launched process ended by itself, read from its output and its exit, in the words a person reads
 * (`failure` of a launch record): its raw output stays in the record as it was.
 *
 * | Code | When | Details |
 * | --- | --- | --- |
 * | `PORT_IN_USE` | `EADDRINUSE` in its output, or a port found taken before it was started | `port`, `address` |
 * | `PERMISSION_DENIED` | `EACCES` listening on a port | `port`, `address` |
 * | `MODULE_MISSING` | `ERR_MODULE_NOT_FOUND`, or "Cannot find package/module" | `specifier`, and the message `Stacks.missing` gives, which names the importing file and its package |
 * | `SYNTAX` | A `SyntaxError` | |
 * | `EXITED` | Anything else | the exit code or signal in the message |
 *
 * ```js
 * Failure.of({ lines: ['Error: listen EADDRINUSE: address already in use 127.0.0.1:5231'], code: 1 });
 * // {code: 'PORT_IN_USE', message: 'Port 5231 is already in use', port: 5231, address: '127.0.0.1'}
 * ```
 */
export class Failure {
	static #LISTEN = /listen (EADDRINUSE|EACCES)[^\n]*?\s(\[?[0-9a-fA-F:.]*\]?|[\w.-]*):(\d{1,5})\b/;
	static #CODE = /\b(EADDRINUSE|EACCES)\b/;
	static #PORT = /port:\s*(\d{1,5})/;
	static #ADDRESS = /address:\s*'([^']+)'/;
	static #MISSING = /Cannot find (?:package|module) '([^']+)'(?: imported from (\S+))?/;

	/**
	 * The failure of a process that ended by itself
	 *
	 * @param {{lines: string[], code?: number | null, signal?: string | null}} ended The lines of its output and how it
	 * exited
	 * @returns {{code: string, message: string, port?: number, address?: string, specifier?: string}}
	 */
	static of({ lines, code, signal }) {
		const text = lines.join('\n');
		return Failure.#listen(text) ?? Failure.#missing(text) ?? Failure.#syntax(text) ?? Failure.exited(code, signal);
	}

	/**
	 * A port that was taken before the process started: nothing was started
	 *
	 * @param {number} port
	 * @param {string} address
	 */
	static taken(port, address) {
		return { code: 'PORT_IN_USE', message: `Port ${port} is already in use`, port, address };
	}

	/**
	 * @param {number | null | undefined} code
	 * @param {string | null | undefined} signal
	 */
	static exited(code, signal) {
		const how = signal ? `was ended by the signal ${signal}` : `ended by itself with code ${code}`;
		return { code: 'EXITED', message: `The process ${how}` };
	}

	static #listen(text) {
		const listen = Failure.#LISTEN.exec(text);
		const kind = listen?.[1] ?? Failure.#CODE.exec(text)?.[1];
		if (!kind) return;
		const port = Number(listen?.[3] ?? Failure.#PORT.exec(text)?.[1]);
		const address = (listen?.[2] || Failure.#ADDRESS.exec(text)?.[1] || '').replace(/^\[|\]$/g, '') || void 0;
		const located = Number.isInteger(port) && port > 0 ? { port, ...(address ? { address } : {}) } : {};
		if (kind === 'EADDRINUSE') return { code: 'PORT_IN_USE', message: located.port ? `Port ${located.port} is already in use` : 'The port it listens on is already in use', ...located };
		if (!listen && !Failure.#PORT.test(text)) return;
		return { code: 'PERMISSION_DENIED', message: located.port ? `Permission denied to listen on port ${located.port}` : 'Permission denied to listen on its port', ...located };
	}

	static #missing(text) {
		const missing = Failure.#MISSING.exec(text);
		if (!missing && !/ERR_MODULE_NOT_FOUND/.test(text)) return;
		if (!missing) return { code: 'MODULE_MISSING', message: 'A module it imports could not be found' };
		const [, specifier, importer] = missing;
		const message = importer ? Stacks.missing({ message: missing[0] }) : `${specifier} could not be found`;
		return { code: 'MODULE_MISSING', message, specifier };
	}

	static #syntax(text) {
		const line = text.split('\n').find(one => /\bSyntaxError\b/.test(one));
		if (!line) return;
		return { code: 'SYNTAX', message: line.trim().replace(/^.*?SyntaxError:\s*/, 'Syntax error: ') };
	}
}
