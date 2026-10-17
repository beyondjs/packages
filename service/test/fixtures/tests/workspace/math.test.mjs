import { test } from 'node:test';
import assert from 'node:assert/strict';

test('adds', () => {
	assert.equal(1 + 1, 2);
});

test('receives the loader configuration', () => {
	assert.match(process.env.BEE_URL, /^http:\/\//);
	assert.equal(process.env.BEE_ADAPTER, 'packages');
	assert.match(process.env.BEE_IDENTITY, /\.beyond[\\/]modules$/);
});

test('subtracts', () => {
	assert.equal(2 - 1, 2);
});

test('later', { skip: 'not yet' }, () => {});
