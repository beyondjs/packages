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
	/** The pinned graph the inventory was traced over, which names the package of each item */
	graph;
	units = new Map();

	/**
	 * @param separate The sources the stylesheet of a module is generated from on its own, as a consumer
	 * that generates every inventory item in a unit of its own does. Without it the stylesheet is taken
	 * from the unit of its module.
	 */
	static async of(store, compiler, entries, conditions, format, separate) {
		const prepared = new Prepared();
		const { graph, sources } = store;
		const measured = await Analysis.measured({ graph, sources, entries, conditions, compiler, format });
		prepared.inventory = measured.inventory;
		prepared.cost = measured.cost;
		prepared.graph = graph;

		for (const item of prepared.inventory.items) {
			// The stylesheet of a module is an output of the unit of that module
			const owned = item.kind === 'style' && prepared.inventory.items.some(one => one.id === item.id.replace(/^style:/, 'module:'));
			if (owned && !separate) continue;
			const from = owned ? separate.sources : sources;
			prepared.units.set(item.id, await Generation.unit({ item, graph, sources: from, conditions, format, compiler }));
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
	 * The stylesheets a document links: the ones a module that is not a widget reaches. A stylesheet that only
	 * widgets reach — the stylesheet of a widget, the shared sheet of its package, one a widget selects — is
	 * adopted inside their roots and never linked by the document.
	 */
	get documented() {
		const widgets = new Set([...this.units].filter(([, unit]) => unit.outputs.some(one => one.kind === 'js' && one.relations.widget)).map(([id]) => id));
		return this.inventory.items.filter(item => item.kind === 'style' && !(item.importers?.length && item.importers.every(id => widgets.has(id)))).map(({ id }) => id);
	}

	/**
	 * Writes every generated output as a file, with an import map of the bare specifiers and an index of
	 * the stylesheets each module owns, which is what an origin serves and a page loads.
	 *
	 * A specifier maps to the code of a module; a stylesheet is mapped only under its specifier with `.css`,
	 * which is how code selects it, so a module that selects a stylesheet never finds code under that name.
	 *
	 * @param directory Where to write; a temporary directory when none is given
	 */
	async write(directory) {
		const root = directory ? resolve(directory) : await mkdtemp(join(tmpdir(), 'beyond-prepared-'));
		await mkdir(root, { recursive: true });

		const imports = {};
		const styles = {};
		const links = [];
		const documented = this.documented;
		let files = 0;

		const emit = async (path, code) => {
			await mkdir(dirname(join(root, path)), { recursive: true });
			await writeFile(join(root, path), code);
			files++;
		};

		for (const item of this.inventory.items) {
			if (item.kind === 'asset') continue;

			// The stylesheet of a module is an output of the unit of that module, in its `styles` family
			const specifier = Keyed.specifier(item, this.graph);
			// A stylesheet generated on its own is preferred to the one the unit of its module produced
			const owner = item.id.replace(/^style:/, 'module:');
			const js = this.output(item.id, 'js');
			const css = this.output(item.id.replace(/^module:/, 'style:'), 'css') ?? this.output(owner, 'css');

			if (js && item.kind === 'module' && !imports[specifier]) {
				const path = Prepared.file(item, 'modules');
				await emit(path, js.code);
				imports[specifier] = `./${path}`;
			}
			if (css && !styles[specifier]) {
				const path = Prepared.file(item, 'styles');
				await emit(path, css.code);
				styles[specifier] = `./${path}`;
				imports[specifier.endsWith('.css') ? specifier : `${specifier}.css`] = `./${path}`;
			}
			if (item.kind === 'style' && documented.includes(item.id) && styles[specifier]) links.push(styles[specifier]);
		}

		await writeFile(join(root, 'importmap.json'), JSON.stringify({ imports }, null, '\t'));
		await writeFile(join(root, 'styles.json'), JSON.stringify(styles, null, '\t'));
		return { directory: root, files, imports, styles, links };
	}
}
