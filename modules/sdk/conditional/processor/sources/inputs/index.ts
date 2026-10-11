import type { ConditionalProcessor } from '../..';
import type { IProcessorInputsStrategy } from '../../types';
import type { WatcherClient } from '@beyond-js/watchers/client';
import type { FileData } from '@beyond-js/file/data';
import { FinderCollection } from '@beyond-js/finder/collection';
import { ProcessorInputsSpec } from './spec';
import { ProcessorInput } from './file';
import { Tests } from './tests';
import { existsSync } from 'fs';
import { join, relative, sep } from 'path';

/**
 * The source files a processor takes as input, found under the module directory and kept up to date.
 *
 * The collection is configured from the specification of the processor, so changing the selection in the
 * module manifest reconfigures it, and it watches the resulting directory when the package provides a
 * watcher client: added, removed and edited files then invalidate the processor that consumes them.
 *
 * A package compiled confined takes no input from outside it: a directory of inputs that leaves the package
 * is not listed, and a file whose real location is outside it (a symbolic link) is not read. Both are kept
 * in `refused`, which the processor reports instead of building.
 */
export class ProcessorInputs extends FinderCollection {
	get dp() {
		return 'processor.inputs';
	}

	#processor: ConditionalProcessor;
	get processor() {
		return this.#processor;
	}

	#watcher: WatcherClient;

	/**
	 * The watcher client of the package, which the input files subscribe their own changes to.
	 * It is undefined when the package was created without watching.
	 */
	get watcher() {
		return this.#watcher;
	}

	#extname: string[];
	#spec: ProcessorInputsSpec;

	/**
	 * What a confined compilation did not take as input, named by its path in the package
	 */
	#refused: Set<string> = new Set();
	get refused(): string[] {
		return [...this.#refused].sort();
	}

	constructor(processor: ConditionalProcessor, strategy: IProcessorInputsStrategy) {
		const { watcher } = processor.conditional.module.package;
		super({ Item: ProcessorInput, watcher });

		this.#processor = processor;
		this.#watcher = watcher;
		this.#extname = typeof strategy.extname === 'string' ? [strategy.extname] : strategy.extname;

		const spec = new ProcessorInputsSpec(this.#processor);
		this.#spec = spec;
		super.setup(new Map([['spec', { child: spec }]]));

		spec.on('initialised', () => this._configure());
		spec.on('change', () => this._configure());
	}

	_configure() {
		if (!this.#spec.valid) {
			super.configure();
			return;
		}

		const { module } = this.#processor.conditional;
		const path = join(module.package.path, module.spec.path, this.#spec.values.path);
		const { includes, excludes, tests } = this.#spec.values;
		const extname = this.#extname;
		const { confinement } = module.package;
		this.#refused.clear();

		// Test files beside the sources are not inputs unless the specification includes them
		const source = tests === 'included' ? void 0 : Tests.source;
		if (!confinement) {
			super.configure(path, { extname, includes, excludes, filter: source });
			return;
		}

		// A directory of inputs that leaves the package is not even listed
		if (!confinement.contains(path) || (existsSync(path) && !confinement.inside(path))) {
			this.#refused.add(this.#named(path));
			super.configure();
			return;
		}

		const filter = (file: FileData) => {
			if (confinement.inside(file.file)) return source ? source(file) : true;
			this.#refused.add(this.#named(file.file));
			return false;
		};
		super.configure(path, { extname, includes, excludes, filter });
	}

	/**
	 * A location as the package names it, relative to its root
	 */
	#named(path: string): string {
		return relative(this.#processor.conditional.module.package.path, path).split(sep).join('/') || '.';
	}
}
