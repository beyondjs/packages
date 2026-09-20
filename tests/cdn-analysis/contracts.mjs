/**
 * The CDN contracts this validation checks Packages against: the JSON Schema documents and fixtures of
 * `beyond-publication/1`, `beyond-graph/1` and `beyond-inventory/1`.
 *
 * They belong to another checkout, located by `CDN_CONTRACTS_DIR` (the contracts directory) or `CDN_DIR`
 * (the CDN checkout, whose `contracts` child is used). The validator is the one that checkout installs.
 * Without either variable the checks that need them are skipped, and say so.
 */
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

export class Contracts {
	#root;

	/**
	 * Why the contracts cannot be used, or undefined when they can
	 */
	get unavailable() {
		if (!this.#root) return 'set CDN_CONTRACTS_DIR (or CDN_DIR) to the CDN contracts checkout';
		if (!existsSync(join(this.#root, 'inventory/schema.json'))) return 'the configured contracts directory has no inventory/schema.json';
		if (!existsSync(join(this.#root, 'node_modules/ajv'))) return 'install the dependencies of the contracts checkout (its validator is used)';
	}

	constructor() {
		const { CDN_CONTRACTS_DIR, CDN_DIR } = process.env;
		this.#root = CDN_CONTRACTS_DIR ? resolve(CDN_CONTRACTS_DIR) : CDN_DIR ? resolve(CDN_DIR, 'contracts') : void 0;
	}

	async #json(...parts) {
		return JSON.parse(await readFile(join(this.#root, ...parts), 'utf8'));
	}

	/**
	 * A validator of one definition of one contract
	 *
	 * @param name `publication`, `graph` or `inventory`
	 * @param definition The name under `$defs`
	 * @returns A function that answers the validation errors of a document, as text; empty when it is valid
	 */
	async validator(name, definition) {
		const Ajv = createRequire(join(this.#root, 'package.json'))('ajv/dist/2020.js');
		const ajv = new (Ajv.default ?? Ajv)({ strict: false, allErrors: true, validateFormats: false });
		const schema = await this.#json(name, 'schema.json');
		ajv.addSchema(schema);
		const validate = ajv.getSchema(`${schema.$id}#/$defs/${definition}`);
		return document => (validate(document) ? [] : validate.errors.map(({ instancePath, message }) => `${instancePath || '/'} ${message}`));
	}

	/**
	 * The fixtures of a contract, by file name
	 *
	 * @param validity `valid` or `invalid`
	 */
	async fixtures(name, validity) {
		const directory = join(name, 'fixtures', validity);
		const files = (await readdir(join(this.#root, directory))).filter(file => file.endsWith('.json')).sort();
		return Promise.all(files.map(async file => ({ file, document: await this.#json(directory, file) })));
	}
}
