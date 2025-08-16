import type Package from '..';
import type { IDiagnostic } from '@beyond-js/packages/types';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';
import { equal } from '@beyond-js/equal/main';

export default class extends DynamicProcessor() {
	get dp() {
		return 'module.resolver';
	}

	#package: Package;
	get package() {
		return this.#package;
	}

	#file;
	#specs;

	get id() {
		return this.#specs.id;
	}

	#module;
	get module() {
		return this.#module;
	}

	#errors: IDiagnostic[] = [];
	get errors() {
		return this.#errors;
	}

	#warnings: IDiagnostic[] = [];
	get warnings() {
		return this.#warnings;
	}

	get valid() {
		return !this.#errors?.length;
	}

	constructor(pkg: Package, file, specs) {
		super();
		this.#package = pkg;
		this.#file = file;
		this.#specs = specs;

		super.setup(
			new Map([
				['bundlers', { child: pkg.bundlers }],
				['specs', { child: specs }]
			])
		);
	}

	// _notify = () => ipc.notify('data-notification', { type: 'record/update', table: 'modules', id: this.id });

	_process() {
		const done = ({ errors, warnings, module }) => {
			const previous = { errors: this.#errors, warnings: this.#warnings, module: !!this.#module };
			const changed = equal({ errors, warnings, module: !!module }, previous);

			this.#errors = errors ? errors : [];
			this.#warnings = warnings ? warnings : [];
			this.#module = module;
			return changed;
		};

		const { bundlers } = this.#package;
		const specs = this.#specs.values;
		if (!bundlers.has(specs.bundler)) {
			return done({ errors: `Module "${specs.bundler}" not found` });
		}

		if (this.#module) return done({ module: this.#module });

		const bundler = bundlers.get(specs.bundler);
		const { meta, settings } = bundler;

		let Module;
		if (typeof meta === 'function') {
			Module = meta;
		} else if (typeof meta === 'object') {
			if (typeof meta.Module !== 'function') {
				const code = 'INVALID_MODULE';
				const message = `Module package didn't return a Module class`;
				return done({ errors: [{ code, message }] });
			}
			Module = meta.Module;
		}

		const path = { dirname: this.#file.dirname, relative: this.#file.relative.dirname };
		const module = new Module({
			package: this.#package,
			path,
			bundler: { name: specs.bundler, settings, path: bundler.path },
			specs: this.#specs
		});
		return done({ module });
	}

	destroy() {
		super.destroy();
		this.#module?.destroy();
	}
}
