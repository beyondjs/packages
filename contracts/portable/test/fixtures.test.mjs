import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import Ajv from 'ajv/dist/2020.js';

const root = new URL('../', import.meta.url);
const json = path => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
const schema = json('schema.json');
const ajv = new Ajv({ strict: true, strictRequired: false, allErrors: true });
ajv.addSchema(schema);
const definition = name => ajv.getSchema(`${schema.$id}#/$defs/${name}`);

/**
 * Fixture files are named `<definition>.<case>.json`. Every file under `valid` must pass its definition and every file
 * under `invalid` must fail it.
 */
for (const expectation of ['valid', 'invalid']) {
	for (const file of readdirSync(new URL(`fixtures/${expectation}/`, root))) {
		test(`${file} is ${expectation}`, () => {
			const validate = definition(file.split('.')[0]);
			assert.ok(validate, `unknown definition in "${file}"`);
			assert.equal(validate(json(`fixtures/${expectation}/${file}`)), expectation === 'valid', JSON.stringify(validate.errors));
		});
	}
}
