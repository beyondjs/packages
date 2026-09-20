import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Service } from '../service.mjs';

test('the environment names the extensions of a service that a caller started without any', () => {
	assert.equal(Service.extensions({}), undefined);
	assert.equal(Service.extensions({ BEYOND_SERVICE_EXTENSIONS: ' , ' }), undefined);
	assert.deepEqual(Service.extensions({ BEYOND_SERVICE_EXTENSIONS: '@beyond-js/packages/development' }), ['@beyond-js/packages/development']);
	assert.deepEqual(Service.extensions({ BEYOND_SERVICE_EXTENSIONS: 'one, file:///two.mjs' }), ['one', 'file:///two.mjs']);
});
