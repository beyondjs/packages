import { readFileSync } from 'node:fs';
import Ajv from 'ajv/dist/2020.js';

const schema = JSON.parse(readFileSync(new URL('../../../contracts/portable/schema.json', import.meta.url), 'utf8'));
const ajv = new Ajv({ strict: true, strictRequired: false, allErrors: true });
ajv.addSchema(schema);

/**
 * Whether a document follows a definition of the portable contract (`contracts/portable/schema.json`), with the
 * errors when it does not
 *
 * ```js
 * const { valid, errors } = conforms('export', record);
 * ```
 *
 * @param {string} definition
 * @param {unknown} document
 */
export const conforms = (definition, document) => {
	const validate = ajv.getSchema(`${schema.$id}#/$defs/${definition}`);
	if (!validate) throw new Error(`The portable contract has no definition "${definition}"`);
	return { valid: validate(document), errors: JSON.stringify(validate.errors) };
};
