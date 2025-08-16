import type { FileData } from '@beyond-js/file/data';
import type { IModuleBundlerSpec } from '@beyond-js/packages/types';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';
import { createHash } from 'crypto';
import { equal } from '@beyond-js/equal/main';

export class BundlerSpec extends DynamicProcessor() implements IModuleBundlerSpec {
	get dp() {
		return 'module-manifest.bundler-spec';
	}

	// The module.json file data
	#file: FileData;

	#id: string;
	get id() {
		return this.#id;
	}

	#bundler: string;
	get bundler() {
		return this.#bundler;
	}

	#subpath: string;
	get subpath() {
		return this.#subpath;
	}

	#description: string;
	get description() {
		return this.#description;
	}

	#values: Record<string, any> = {};
	get values() {
		return this.#values;
	}

	constructor(file: FileData, bundler: string) {
		super();
		this.#file = file;
		this.#id = createHash('md5').update(`${file.file}:${bundler}`).digest('hex').toString();
		this.#bundler = bundler;
	}

	update(values: Record<string, any>) {
		values = values || {};

		// Just for backward compatibility ('name' as subpath synonimous)
		const { name } = values;
		values.name = typeof name === 'string' && !name.startsWith('.') ? `./${name}` : name;
		values.subpath = values.subpath ? values.subpath : values.name;
		delete values.name;

		// If the subpath is not defined, use the relative dirname of the file
		const { dirname } = this.#file.relative;
		values.subpath = typeof values.subpath === 'string' ? values.subpath : dirname.replace(/\\/g, '/');

		const changed = !equal(values, this.#values);
		if (!changed) return;

		this.#values = values;
		this._invalidate();
	}
}
