import type { FileData } from '@beyond-js/file/data';
import type { IDiagnostic } from '@beyond-js/packages/types';

/**
 * The files of a module directory that are tests or their fixtures, and not sources of the module.
 *
 * A processor takes every file of the module directory as input, so a test written beside the file it tests
 * would be compiled into the public module and shipped with it. These files are left out by default:
 * `<name>.test.<ext>` and `<name>.spec.<ext>` at any depth, and everything under a `__tests__` or a
 * `__fixtures__` directory. A processor whose specification sets `tests` to `included` takes them.
 */
export class Tests {
	static PATTERN = /(^|\/)(__tests__|__fixtures__)\/|\.(test|spec)\.[^/]+$/;

	/**
	 * The values `tests` accepts in the specification of a processor
	 */
	static VALUES = ['excluded', 'included'];

	/**
	 * The diagnostic of a `tests` value the specification does not accept, or undefined when it is accepted
	 */
	static check(value: unknown): IDiagnostic | undefined {
		if (value === void 0 || Tests.VALUES.includes(<string>value)) return;

		const code = 'INVALID_TESTS_CONFIGURATION';
		const message = `Tests configuration is invalid. One of ${Tests.VALUES.map(value => `"${value}"`).join(', ')} is expected.`;
		return { code, message };
	}

	/**
	 * Whether a file of the module directory is a source and not a test
	 */
	static source(file: FileData): boolean {
		return !Tests.PATTERN.test(file.relative.file.replace(/\\/g, '/'));
	}
}
