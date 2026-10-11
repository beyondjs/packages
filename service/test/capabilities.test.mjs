import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { Capabilities } from '../host/capabilities.mjs';

const answer = (request, response) => response.end();

test('a service without the development extension implements its state and its installation', () => {
	const app = express();
	app.get(['/session', '/state', '/selection'], answer);
	const capabilities = new Capabilities();
	capabilities.read(app);
	assert.deepEqual(capabilities.map, { state: 1, installation: 1 });
});

test('the capabilities of the development extension are read from the routes it mounted', () => {
	const app = express();
	app.get('/files/tree', answer);
	app.get('/events', answer);
	app.post('/builds', answer);
	app.get('/builds/:id', answer);
	app.get('/declarations/*', answer);
	app.get('/development/selection', answer);
	app.get('/preview', answer);
	app.get('/preview/entry.json', answer);
	const capabilities = new Capabilities();
	capabilities.read(app);
	assert.deepEqual(capabilities.map, { state: 1, installation: 1, files: 1, events: 1, builds: 1, declarations: 1, selection: 1, preview: 1 });

	// The composition document is a capability only where the preview serves it
	app.get('/preview/composition.json', answer);
	capabilities.read(app);
	assert.equal(capabilities.map.composition, 1);
});

test('a route mounted for another method is not the capability', () => {
	const app = express();
	app.get('/builds', answer);
	app.post('/files/tree', answer);
	const capabilities = new Capabilities();
	capabilities.read(app);
	assert.deepEqual(capabilities.map, { state: 1, installation: 1 });
});

test('the features of the host add their own capabilities', () => {
	const capabilities = new Capabilities();
	capabilities.add({ pairing: 1, exports: 1 });
	capabilities.add({ ui: 1 });
	assert.deepEqual(capabilities.map, { state: 1, installation: 1, pairing: 1, exports: 1, ui: 1 });
	const map = capabilities.map;
	map.state = 9;
	assert.equal(capabilities.map.state, 1, 'a copy');
});
