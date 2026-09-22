import type { IDiagnostic } from '@beyond-js/packages/types';
import type { IInternalModule } from './';
import type { Widget } from './widget';
import Concat from 'concat-with-sourcemaps';
import { header } from './header';
import { Compatibility, KERNEL } from './compatibility';
import { WIDGETS } from './widget';
import { Mapping } from './mapping';
import { posix } from 'path';

/**
 * The names an artifact declares for the runtime at its top level, which a public export cannot take:
 * `hmr` and `__beyond_pkg` are part of what every artifact exports, and the others are its own bindings.
 */
const RESERVED = /^(hmr|_default|__beyond_pkg|__pkg|__ims|__Bundle|__bundle|__instances|dependency_\d+)$/;

interface IParams {
	vspecifier: string;
	entry: string;
	ims: IInternalModule[];

	/**
	 * The public module that implements the runtime contract the artifact is written against
	 */
	runtime?: string;

	/**
	 * Whether the module produces a stylesheet, which the runtime registers for the module
	 */
	styles?: boolean;

	/**
	 * The widget the module declares, when it is one
	 */
	widget?: Widget;
}

/**
 * Generates the code of a public module artifact from its internal modules.
 *
 * The emitted ES module is composed of four parts:
 *
 * 1. The imports. The runtime and every public dependency are imported by bare specifier, which is how a
 *    packaged module keeps referring to other public modules instead of embedding them. A specifier of a
 *    Kernel family is imported from the selected runtime (see `Compatibility`).
 * 2. The runtime package. The artifact creates it from its versioned identity, or, in an update, obtains
 *    the one already registered under that identity, and registers the imported dependencies in it. The
 *    bundle specification says whether the module has a stylesheet and whether it is a widget.
 * 3. The internal modules. Each source file becomes `creator(require, exports)` registered by identity and
 *    content hash. The runtime evaluates a creator on demand and, on an update, replaces only the creators
 *    whose hash changed; `require` resolves relative identities inside the module and bare specifiers
 *    through the registered dependencies.
 * 4. The public API. The exports descriptor maps public names to the entry point that produces them, and
 *    the `export let` bindings are assigned through a closure that the runtime keeps and calls again after
 *    an update, so consumers of the original import observe the new values. A widget also registers
 *    itself with the Widgets runtime before its internal modules are evaluated.
 *
 * An update reuses parts 1 to 3 and ends with `update(ims)` instead of `initialise(ims)`. It emits no
 * export statements: the bindings of an ES module are fixed when it is first evaluated, so the update
 * assigns the existing ones through the retained closure. Adding or removing a public export therefore
 * changes the module shape and requires reloading it rather than updating it.
 */
export class Assembler {
	#vspecifier: string;
	#entry: string;
	#runtime: string;
	#styles: boolean;
	#widget: Widget;
	#compatibility: Compatibility;

	/**
	 * The runtime public module the artifact imports
	 */
	get runtime() {
		return this.#runtime;
	}

	#ims: IInternalModule[];

	/**
	 * The internal modules in the order they are emitted
	 */
	get ims() {
		return this.#ims;
	}

	#errors: IDiagnostic[] = [];
	get errors() {
		return this.#errors;
	}

	/**
	 * The bare specifiers the internal modules require, as their sources wrote them, in a stable order
	 */
	#required: string[];

	#dependencies: string[];

	/**
	 * The public modules the artifact imports, in a stable order: the required specifiers mapped to the
	 * selected runtime, plus the Widgets runtime of a widget
	 */
	get dependencies() {
		return this.#dependencies;
	}

	#exports: string[];

	/**
	 * The public API of the module, in a stable order
	 */
	get exports() {
		return this.#exports;
	}

	constructor({ vspecifier, entry, ims, runtime, styles, widget }: IParams) {
		this.#vspecifier = vspecifier;
		this.#entry = entry;
		this.#runtime = runtime ?? KERNEL;
		this.#styles = !!styles;
		this.#widget = widget?.specs ? widget : void 0;
		this.#compatibility = new Compatibility(this.#runtime);

		/**
		 * Internal modules, dependencies and exports are ordered by identity so that the emitted code, and
		 * therefore its hash, depends on the sources and not on the order in which they were discovered
		 */
		this.#ims = [...ims].sort((one, another) => (one.id < another.id ? -1 : one.id > another.id ? 1 : 0));

		const required = new Set<string>();
		ims.forEach(({ output }) => output.code.dependencies.forEach(dependency => required.add(dependency)));
		this.#required = [...required].sort();

		const dependencies = new Set(this.#required.map(specifier => this.#compatibility.resolve(specifier)));
		this.#widget && dependencies.add(WIDGETS);
		this.#dependencies = [...dependencies].sort();

		this.#exports = this.#resolve();
	}

	/**
	 * The public API of the module: the names exported by its entry point.
	 *
	 * Exports of other internal files are internal unless the entry point re-exports them. A
	 * `export * from './other'` therefore contributes the names of that internal module, excluding its
	 * default export, as the ES module semantics prescribe.
	 */
	#resolve(): string[] {
		const ims = new Map(this.#ims.map(im => [im.id, im]));

		// An internal specifier is relative to the internal module that requires it, and a directory
		// resolves to its index, as the runtime resolves them
		const target = (id: string, specifier: string): IInternalModule | undefined => {
			const resolved = posix.normalize(posix.join(posix.dirname(id), specifier));
			const candidate = resolved.startsWith('.') ? resolved : `./${resolved}`;
			return ims.get(candidate) ?? ims.get(`${candidate}/index`);
		};

		const names = new Set<string>();
		const visited = new Set<string>();

		const collect = (im: IInternalModule, star: boolean) => {
			// A cycle of star re-exports contributes each name once
			if (visited.has(im.id)) return;
			visited.add(im.id);

			im.output.code.exports.forEach(name => {
				if (star && name === 'default') return;
				names.add(name);
			});

			im.output.code.reexports.forEach(specifier => {
				const reexported = target(im.id, specifier);
				if (!reexported) {
					const code = 'REEXPORT_NOT_FOUND';
					const message = `Internal module "${im.id}" re-exports "${specifier}", which is not an internal module`;
					this.#errors.push({ code, message });
					return;
				}
				collect(reexported, true);
			});
		};

		const entry = ims.get(this.#entry);
		entry && collect(entry, false);

		[...names].filter(name => RESERVED.test(name)).forEach(name => {
			const code = 'EXPORT_RESERVED';
			const message = `The public export "${name}" is a name the artifact reserves for the runtime. Rename the export`;
			this.#errors.push({ code, message });
		});

		if (this.#widget && !names.has('Controller')) {
			const code = 'WIDGET_CONTROLLER_MISSING';
			const message = `The entry point of widget "${this.#widget.specs.name}" must export its "Controller"`;
			this.#errors.push({ code, message });
		}
		return [...names].sort();
	}

	/**
	 * The specification of the runtime bundle: the identity, the type, and what the runtime registers for it
	 */
	get #specs(): string {
		const specs: Record<string, unknown> = { module: { vspecifier: this.#vspecifier }, type: this.#widget ? 'widget' : 'ts' };
		this.#styles && (specs.styles = true);
		return JSON.stringify(specs);
	}

	/**
	 * Generates the code and the source map of the artifact
	 *
	 * @param hmr Whether to generate the update of an already loaded module instead of the initial artifact
	 */
	assemble({ hmr }: { hmr: boolean }): { code: string; map: string } {
		const concat = new Concat(true, `${this.#vspecifier}${hmr ? '.hmr' : ''}.js`, '\n');
		const add = (code: string) => concat.add(null, code);

		// 1. The runtime and the public dependencies, imported by bare specifier
		const runtime = this.#runtime;
		const imports = [runtime, ...this.#dependencies.filter(dependency => dependency !== runtime)];
		const index = (specifier: string) => imports.indexOf(specifier);
		imports.forEach((dependency, i) => add(`import * as dependency_${i} from '${dependency}';`));
		add('');

		// 2. The runtime package: created by the artifact, obtained by the update
		if (!hmr) {
			add('const { Bundle: __Bundle } = dependency_0;');
			add(`const __pkg = new __Bundle(${this.#specs}, import.meta.url).package();`);
		} else {
			add('const { instances: __instances } = dependency_0;');
			add(`const __bundle = __instances.get('${this.#vspecifier}');`);
			add(
				`if (!__bundle) throw new Error('Public module "${this.#vspecifier}" is not loaded, its update cannot be applied');`
			);
			add('const __pkg = __bundle.package();');
		}

		/**
		 * The dependency namespaces that the internal requires of bare specifiers resolve to, registered
		 * under the specifier the sources wrote and bound to the module the artifact imported for it
		 */
		const registrations = this.#required
			.map(specifier => ({ specifier, resolved: this.#compatibility.resolve(specifier) }))
			.filter(({ resolved }) => resolved !== runtime)
			.map(({ specifier, resolved }) => `['${specifier}', dependency_${index(resolved)}]`);
		add(`__pkg.dependencies.update([${registrations.join(', ')}]);`);
		add('');

		// 3. The internal modules, each identified and hashed
		add('const __ims = new Map();');
		this.#ims.forEach(im => {
			const { id, hash, output } = im;
			const mapping = new Mapping(im);
			add('');
			add(header(`INTERNAL MODULE: ${id}`));
			/**
			 * The map of the file is preserved, naming the source by its absolute path, so that diagnostics,
			 * stack traces and coverage point at the original source; the creator boundaries are mapped to
			 * the ends of that source. A transformer that produced no map is mapped line by line to the file.
			 */
			concat.add(null, `__ims.set('${id}', { hash: ${hash}, creator: function (require, exports) {`, mapping.opening);
			concat.add(mapping.map ? null : mapping.file, output.code.code(), mapping.map);
			concat.add(null, '}});', mapping.closing);
		});
		add('');

		// 4. The public API, produced by the entry point
		const descriptor = this.#exports.map(name => ({ im: this.#entry, from: name, name }));
		add(`__pkg.exports.descriptor = ${JSON.stringify(descriptor)};`);

		if (!hmr) {
			const named = this.#exports.filter(name => name !== 'default');
			named.length && add(`export let ${named.join(', ')};`);

			/**
			 * `default` cannot be a binding identifier, so it is exported through an alias of a local binding.
			 * `export default _default` would export the value the binding has when that statement is
			 * evaluated, which is before the runtime assigns it; the alias is a live binding, as the named
			 * exports are, and keeps `_default` itself out of the public API.
			 */
			if (this.#exports.includes('default')) {
				add('let _default;');
				add('export { _default as default };');
			}

			/**
			 * The runtime calls this closure with `require` when it refreshes every public binding, and with
			 * `prop`/`value` when one exported value changes. It keeps the closure across updates, which is
			 * why an update does not need to emit it again. The closure declares no parameters: a parameter
			 * named as a public export (`value` is an ordinary one) would shadow the binding it must assign.
			 * `arguments` cannot name a binding of an ES module, so reading the call from it cannot collide.
			 */
			add('__pkg.exports.process = function () {');
			this.#exports.forEach(name => {
				const binding = name === 'default' ? '_default' : name;
				const exported = `arguments[0].require('${this.#entry}')['${name}']`;
				add(
					`\t(arguments[0].require || arguments[0].prop === '${name}') && ` +
						`(${binding} = arguments[0].require ? ${exported} : arguments[0].value);`
				);
			});
			add('};');

			/**
			 * The runtime package itself, used by the runtime to initialise this module when another one
			 * depends on it, and by development clients to subscribe to its updates
			 */
			add('export const __beyond_pkg = __pkg;');
			add('export const hmr = {');
			add('\ton: (event, listener) => __pkg.hmr.on(event, listener),');
			add('\toff: (event, listener) => __pkg.hmr.off(event, listener)');
			add('};');

			// A widget is registered before its controller is evaluated, so importing the module suffices
			this.#widget && add(this.#widget.registration(`dependency_${index(WIDGETS)}`));
		}

		// Registering and evaluating, or comparing hashes and replacing the changed creators
		add(hmr ? '__pkg.update(__ims);' : '__pkg.initialise(__ims);');

		return { code: concat.content.toString(), map: concat.sourceMap };
	}
}
