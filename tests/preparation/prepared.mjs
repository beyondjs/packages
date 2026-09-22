/**
 * An application prepared the way a consumer prepares one: traced into an inventory, then one generation
 * unit per item, and the outputs written where a page can load them.
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Identity, ModulePath } from '@beyond-js/artifact-api';
import { Analysis, Keyed } from '@beyond-js/packages/analysis';
import { Generation } from '@beyond-js/packages/generation';

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

	/**
	 * Where a file of an item is delivered: the path of the compiled-module contract, which is what a
	 * consumer of published outputs serves. An artifact addresses its companions from its own address —
	 * the stylesheet of a module is its `styles` family, and the shared sheet of a package is the `global`
	 * one of that package — so the layout is part of what makes a delivered application work.
	 */
	static file(item, family) {
		const name = item.package.slice(item.package.indexOf(':') + 1).replace(/@[^@/]+$/, '');
		const version = item.package.slice(item.package.lastIndexOf('@') + 1);
		const subpath = item.subpath === '.' ? '.' : `./${item.subpath}`;
		const path = ModulePath.format(new Identity({ name, version, subpath }));
		return path.replace(/^\//, '').replace('/modules/', `/${family}/`);
	}

	/**
	 * The output of an item by kind
	 */
	output(id, kind) {
		return this.units.get(id)?.outputs.find(one => one.kind === kind);
	}

	/**
	 * Writes every generated output as a file, with an import map of the bare specifiers and an index of
	 * the stylesheets each module owns, which is what an origin serves and a page loads
	 *
	 * @param directory Where to write; a temporary directory when none is given
	 */
	async write(directory) {
		const root = directory ? resolve(directory) : await mkdtemp(join(tmpdir(), 'beyond-prepared-'));
		await mkdir(root, { recursive: true });

		const imports = {};
		const styles = {};
		let files = 0;

		const emit = async (path, code) => {
			await mkdir(dirname(join(root, path)), { recursive: true });
			await writeFile(join(root, path), code);
			files++;
		};

		for (const item of this.inventory.items) {
			if (item.kind === 'asset') continue;

			// The stylesheet of a module is an output of the unit of that module, in its `styles` family
			const specifier = Keyed.specifier(item);
			const owner = item.id.replace(/^style:/, 'module:');
			const js = this.output(item.id, 'js');
			const css = this.output(this.units.has(owner) ? owner : item.id, 'css');

			if (js && !imports[specifier]) {
				const path = Prepared.file(item, 'modules');
				await emit(path, js.code);
				imports[specifier] = `./${path}`;
			}
			if (css && !styles[specifier]) {
				const path = Prepared.file(item, 'styles');
				await emit(path, css.code);
				styles[specifier] = `./${path}`;
			}
		}

		await writeFile(join(root, 'importmap.json'), JSON.stringify({ imports }, null, '\t'));
		await writeFile(join(root, 'styles.json'), JSON.stringify(styles, null, '\t'));
		return { directory: root, files, imports, styles };
	}
}
