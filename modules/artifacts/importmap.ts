import type { IConditions } from '@beyond-js/packages/types';
import type { IArtifact } from './types';
import { promises as fs } from 'fs';
import { join } from 'path';

/**
 * The file name of the import map inside the artifacts directory
 */
export const FILENAME = 'importmap.json';

/**
 * The import map that resolves the public specifiers preserved by the artifacts.
 *
 * Its `imports` follow the standard import-map shape, so a browser or a Node loader consumes it directly.
 * The `beyond` property adds the provenance that a development service needs: which build produced each
 * artifact, where its update file is, and how its dependencies were resolved.
 */
export class ImportMap {
	#conditions: IConditions;
	#imports: Record<string, string> = {};
	#artifacts: IArtifact[] = [];

	constructor(conditions: IConditions) {
		this.#conditions = conditions;
	}

	/**
	 * Publishes one written artifact under the public specifier of its module
	 */
	add(artifact: IArtifact): void {
		this.#imports[artifact.specifier] = `./${artifact.file}`;
		this.#artifacts.push(artifact);
	}

	/**
	 * Writes the map in the artifacts directory
	 */
	async write(path: string): Promise<string> {
		const beyond = {
			generator: '@beyond-js/packages/artifacts',
			conditions: this.#conditions,
			artifacts: this.#artifacts.map(({ specifier, vspecifier, file, patch, hash, dependencies }) => ({
				specifier,
				vspecifier,
				file,
				patch,
				hash,
				dependencies
			}))
		};

		await fs.mkdir(path, { recursive: true });
		await fs.writeFile(join(path, FILENAME), JSON.stringify({ imports: this.#imports, beyond }, null, '\t'));
		return FILENAME;
	}
}
