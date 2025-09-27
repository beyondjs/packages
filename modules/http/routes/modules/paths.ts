import type { Options } from './options';
import { createHash } from 'crypto';

export class Paths {
	static #base: string = '/m';

	static map(options: Options): string {
		const { identifier, target, format, environment, min } = options;
		const key = `${identifier}:${target}:${format}:${environment}:${min}`;

		const hash = createHash('sha1').update(key).digest('hex').slice(0, 12);
		return `${this.#base}/maps/${hash}.map`;
	}

	static dts(options: Options): string {
		const { identifier, module } = options;
		return `${this.#base}/${identifier}/types/${module}.d.ts`;
	}

	static css(options: Options): string {
		const { identifier, module } = options;
		return `${this.#base}/${identifier}/styles/${module}.css`;
	}
}
