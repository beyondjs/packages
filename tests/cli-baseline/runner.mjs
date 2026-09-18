/**
 * Builds a fixture workspace and executes its artifacts in a separate Node process, which is how these cases
 * observe what a consumer actually receives rather than what a build report claims.
 */
import { spawn } from 'node:child_process';
import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { Workspace } from '@beyond-js/packages/workspace';
import { Artifacts } from '@beyond-js/packages/artifacts';

export const conditions = { platform: 'node' };

/**
 * The expression a consumer evaluates: it imports one public specifier and prints what it observed as JSON
 */
const script = specifier => `
const module = await import(${JSON.stringify(specifier)});
const read = value => (typeof value === 'function' ? value() : value);
const values = Object.fromEntries(Object.keys(module).filter(key => !['__beyond_pkg', 'hmr'].includes(key))
	.map(key => [key, read(module[key])]));
console.log(JSON.stringify(values));
`;

export class Build {
	#fixture;
	#path;

	report;

	constructor(fixture) {
		this.#fixture = fixture;
		this.#path = fixture.path('.artifacts');
	}

	/**
	 * Builds with a new workspace each time, which is what a process started after an edit observes
	 */
	async run() {
		const workspace = new Workspace(this.#fixture.root);
		try {
			this.report = await new Artifacts(workspace, { path: this.#path, conditions }).build();
		} finally {
			workspace.destroy();
		}
		return this.report;
	}

	artifact(specifier) {
		return this.report.artifacts.find(one => one.specifier === specifier);
	}

	codes() {
		return this.report.errors.map(one => one.code);
	}

	async importmap() {
		return JSON.parse(await readFile(join(this.#path, 'importmap.json'), 'utf8')).imports;
	}

	/**
	 * Whether a file is reachable in the artifacts directory, whatever the report says about it
	 */
	async exists(file) {
		return access(join(this.#path, file)).then(
			() => true,
			() => false
		);
	}

	/**
	 * Imports a public specifier in a consumer process and returns its public values; functions are called
	 *
	 * @returns {Promise<{code: number, values?: Record<string, unknown>, stderr: string}>}
	 */
	execute(specifier) {
		const execArgv = process.execArgv.filter(arg => !arg.startsWith('--inspect'));
		const args = [...execArgv, '--input-type=module', '--eval', script(specifier)];
		const env = Object.assign({}, process.env, { BEE_URL: '', BEE_IMPORT_MAP: join(this.#path, 'importmap.json') });

		// The runtime is an installed package of the Packages checkout, resolved from the working directory
		const child = spawn(process.execPath, args, { cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'] });

		let stdout = '';
		let stderr = '';
		child.stdout.on('data', data => (stdout += data));
		child.stderr.on('data', data => (stderr += data));

		return new Promise(resolve =>
			child.once('exit', code => {
				const line = stdout.trim().split('\n').pop();
				resolve({ code, stderr, values: code === 0 && line ? JSON.parse(line) : undefined });
			})
		);
	}
}
