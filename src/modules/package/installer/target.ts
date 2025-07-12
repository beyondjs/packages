import { join } from 'path';
import type { Info } from './types';

export class Target {
	readonly dir: string;
	readonly file: string;

	constructor(info: Info, env: 'local' | 'ci' | 'cdn') {
		const { name, version, source, ref } = info;

		let base = join(process.cwd(), '.beyond', 'packages');

		if (env === 'cdn') base = '/mnt/storage/cdn/packages';
		else if (env === 'ci') base = '/tmp/beyond/ci';

		let key: string;
		switch (source) {
			case 'npm':
				key = `${name}@${version}`;
				break;
			case 'github':
				key = join(name, ref ?? 'main');
				break;
			case 'github-pkg':
			case 'gitlab':
			case 'artifactory':
			case 'url':
				key = `${name.replace(/[^a-z0-9@]/gi, '-')}-${version}`;
				break;
			default:
				throw new Error(`Unsupported source: ${source}`);
		}

		this.file = join(base, source, `${key}.tgz`);
		this.dir = join(base, source, key);
	}
}
