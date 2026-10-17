import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspect } from 'node:util';

/**
 * How an uncaught error of a launched module is printed: its stack (source-mapped when the process runs with
 * `--enable-source-maps`) without the frames of the toolchain (Node's internals, `@beyond-js/kernel`, BEE Node, the
 * loader and the launcher), and a missing package said as what to do about it.
 *
 * `register.mjs` of this directory installs it in a process (`node --import <register.mjs>`), which is how the
 * development service launches a target and how the command line may run a module. It acts only when nothing else
 * handles uncaught errors in that process: a program with its own `uncaughtException` listener keeps its behavior.
 *
 * ```js
 * const stacks = new Stacks({ hidden: ['/toolchain/cli'] });
 * stacks.text(error);   // what is printed
 * ```
 */
export class Stacks {
	/**
	 * Frames of the toolchain, hidden from every stack
	 */
	static TOOLCHAIN = Object.freeze([/\bnode:internal\//, /[\\/]@beyond-js[\\/](kernel|bee)[\\/]/, /[\\/]bee-node[\\/]/, /[\\/]packages-bootstrap[\\/]/]);

	/**
	 * The variable that names more directories whose frames are hidden: a JSON list of absolute paths (the loader's and
	 * the launcher's)
	 */
	static VARIABLE = 'BEYOND_STACKS_HIDDEN';

	static #MISSING = /Cannot find (?:package|module) '([^']+)' imported from (\S+)/;

	#hidden;

	/**
	 * @param {{hidden?: string[], environment?: Record<string, string | undefined>}} [options] Directories whose frames
	 * are hidden, besides the ones the environment names
	 */
	constructor({ hidden = [], environment = process.env } = {}) {
		let named = [];
		try {
			const parsed = JSON.parse(environment[Stacks.VARIABLE] ?? '[]');
			named = Array.isArray(parsed) ? parsed.filter(one => typeof one === 'string' && one) : [];
		} catch {
			// Not a list: only the toolchain's own frames are hidden
		}
		this.#hidden = [...hidden, ...named].map(path => path.replace(/[\\/]+$/, ''));
	}

	/**
	 * Whether a line of a stack is a frame of the toolchain
	 *
	 * @param {string} line
	 */
	hides(line) {
		if (!/^\s+at\s/.test(line)) return false;
		const text = line.replace(/file:\/\//g, '');
		return Stacks.TOOLCHAIN.some(pattern => pattern.test(line)) || this.#hidden.some(path => text.includes(`${path}${sep}`) || text.includes(`${path}/`));
	}

	/**
	 * A stack without the toolchain's frames; when every frame is the toolchain's, the stack as it was
	 *
	 * @param {string} stack
	 */
	filter(stack) {
		const lines = String(stack).split('\n');
		const kept = lines.filter(line => !this.hides(line));
		const frames = kept.filter(line => /^\s+at\s/.test(line));
		return frames.length || !lines.some(line => /^\s+at\s/.test(line)) ? kept.join('\n') : lines.join('\n');
	}

	/**
	 * What a missing package or module is, said as what to do, undefined for any other error
	 *
	 * @param {unknown} error
	 */
	static missing(error) {
		const message = String(error?.message ?? '');
		const found = Stacks.#MISSING.exec(message);
		if (!found && error?.code !== 'ERR_MODULE_NOT_FOUND') return;
		if (!found) return `A module that is imported could not be found: ${message}`;

		const [, specifier, importer] = found;
		const file = importer.startsWith('file:') ? fileURLToPath(importer) : importer;
		if (/^(\.|\/|[a-z]+:)/i.test(specifier)) return `${specifier}, imported by ${file}, does not exist`;
		const owner = Stacks.#package(file);
		return `${specifier} is imported by ${file} but is not a dependency of ${owner ?? 'its package'}: add it to its dependencies and run beyond install`;
	}

	/**
	 * The name of the package a file belongs to: the nearest package.json above it that names one
	 */
	static #package(file) {
		if (!file.startsWith('/') && !/^[a-z]:[\\/]/i.test(file)) return;
		for (let directory = dirname(file); ; directory = dirname(directory)) {
			const manifest = join(directory, 'package.json');
			try {
				if (existsSync(manifest)) {
					const { name } = JSON.parse(readFileSync(manifest, 'utf8'));
					if (typeof name === 'string' && name) return name;
				}
			} catch {
				// An unreadable manifest names no package
			}
			if (dirname(directory) === directory) return;
		}
	}

	/**
	 * What is printed for an uncaught error
	 *
	 * @param {unknown} error
	 */
	text(error) {
		if (!(error instanceof Error) && typeof error?.stack !== 'string') return `Uncaught ${inspect(error)}`;
		const missing = Stacks.missing(error);
		const stack = this.filter(error.stack ?? `${error.name}: ${error.message}`);
		return missing ? `${missing}\n\n${stack}` : stack;
	}

	/**
	 * Prints an uncaught error this way and ends the process with code 1, unless the program handles uncaught errors
	 * itself
	 *
	 * @param {NodeJS.Process} [target]
	 */
	install(target = process) {
		const listener = error => {
			// Another listener means the program handles its uncaught errors: its behavior is kept
			if (target.listenerCount('uncaughtException') > 1) return;
			target.stderr.write(`${this.text(error)}\n`);
			target.exit(1);
		};
		target.on('uncaughtException', listener);
		return () => target.off('uncaughtException', listener);
	}
}
