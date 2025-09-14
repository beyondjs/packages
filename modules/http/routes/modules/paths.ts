import type { IOptions } from './';
import { createHash } from 'crypto';

function vspecifier(o: IOptions): string {
	return (o.scope ? `@${o.scope}/` : '') + o.package + `@${o.version}/${o.module}`;
}

export class Paths {
	static #base: string = '/m';

	static map(o: IOptions): string {
		const key = `${vspecifier(o)}:${o.target}:${o.format}:${o.environment}:${o.min}`;
		const hash = createHash('sha1').update(key).digest('hex').slice(0, 12);
		return `${this.#base}/maps/${hash}.map`;
	}

	static dts(o: IOptions): string {
		const pre = o.scope ? `@${o.scope}/` : '';
		return `${this.#base}/${pre}${o.package}@${o.version}/types/${o.module}.d.ts`;
	}

	static css(o: IOptions): string {
		const pre = o.scope ? `@${o.scope}/` : '';
		return `${this.#base}/${pre}${o.package}@${o.version}/styles/${o.module}.css`;
	}
}
