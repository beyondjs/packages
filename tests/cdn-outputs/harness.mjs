/**
 * The infrastructure of the output validation: generating every item of an inventory, writing ES module
 * outputs where a Node process can import them, and running that process.
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Analysis, Keyed } from '@beyond-js/packages/analysis';
import { Generation } from '@beyond-js/packages/generation';

export { Report } from '../cdn-analysis/harness.mjs';
export { Store, Selected } from '../cdn-analysis/store.mjs';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * An application prepared the way a CDN job prepares it: traced, then one unit per inventory item
 */
export class Prepared {
	inventory;
	cost;
	units = new Map();

	static async of(store, compiler, entries, conditions, format) {
		const prepared = new Prepared();
		const { graph, sources } = store;
		const measured = await Analysis.measured({ graph, sources, entries, conditions, compiler, format });
		prepared.inventory = measured.inventory;
		prepared.cost = measured.cost;
		for (const item of prepared.inventory.items) {
			// The stylesheet of a module is an output of the unit of that module
			if (item.kind === 'style' && prepared.inventory.items.some(one => one.id === item.id.replace(/^style:/, 'module:'))) continue;
			prepared.units.set(item.id, await Generation.unit({ item, graph, sources, conditions, format, compiler }));
		}
		return prepared;
	}

	get diagnostics() {
		return [...this.units.values()].flatMap(({ diagnostics }) => diagnostics);
	}

	/**
	 * The code of each generated module, by the bare specifier that references it
	 */
	get code() {
		const code = new Map();
		for (const item of this.inventory.items) {
			const js = this.units.get(item.id)?.outputs.find(({ kind }) => kind === 'js');
			js && code.set(Keyed.specifier(item), js.code);
		}
		return code;
	}

	/**
	 * Writes the ES module outputs and an import map of their bare specifiers
	 *
	 * @returns The import map file
	 */
	async write(directory) {
		const imports = {};
		for (const [specifier, code] of this.code) {
			const file = `${specifier.replace(/[^\w.-]+/g, '_')}.mjs`;
			await mkdir(directory, { recursive: true });
			await writeFile(join(directory, file), code);
			imports[specifier] = `./${file}`;
		}
		const importmap = join(directory, 'importmap.json');
		await writeFile(importmap, JSON.stringify({ imports }, null, '\t'));
		return importmap;
	}
}

/**
 * Runs a scenario of the consumer process against an import map, in a directory where no package is
 * installed: whatever the outputs import must come from the map or from Node itself
 */
export class Consumer {
	static run(scenario, importmap, cwd) {
		return new Promise((done, reject) => {
			// The loader may have been named relatively to the directory this run started in
			const execArgv = process.execArgv
				.filter(arg => !arg.startsWith('--inspect'))
				.map((arg, index, all) => (all[index - 1] === '--import' && /^\.\.?\//.test(arg) ? resolve(arg) : arg));
			const env = Object.assign({}, process.env, { BEE_URL: '', BEE_IMPORT_MAP: importmap });
			const child = spawn(process.execPath, [...execArgv, join(here, 'consumer.mjs'), scenario], { cwd, env });

			let stdout = '';
			let stderr = '';
			child.stdout.on('data', chunk => (stdout += chunk));
			child.stderr.on('data', chunk => (stderr += chunk));
			const timer = setTimeout(() => child.kill(), 30000);
			child.on('exit', code => {
				clearTimeout(timer);
				const line = stdout.split('\n').find(one => one.startsWith('RESULT '));
				line ? done(JSON.parse(line.slice(7))) : reject(new Error(`consumer exited with code ${code}\n${stderr || stdout}`));
			});
		});
	}
}
