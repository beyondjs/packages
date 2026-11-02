import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Destinations } from '../host/exports/destinations.mjs';
import { Transfer } from '../host/exports/transfer.mjs';

// The family's Snapshots answers its API at api.snapshots.beyondjs.com; snapshots.beyondjs.com is its interface,
// where no API answers in production, so an upload addressed there is refused unless someone declares it.
const API = 'https://api.snapshots.beyondjs.com';
const INTERFACE = 'https://snapshots.beyondjs.com';
const CAPTURE = 'cap_1';
const record = { state: 'ready', packages: [{ path: 'packages/web' }] };

const body = origin => ({
	capture: { id: CAPTURE },
	grants: [{ path: 'packages/web', upload: `${origin}/v1/captures/${CAPTURE}/archive?package=packages%2Fweb`, token: 'grant' }]
});

const prepare = (origin, destinations, caller) => Transfer.prepare(record, body(origin), { origins: destinations.for(caller) });

test("the family's Snapshots origin is its API, not its interface host", () => {
	assert.equal(Destinations.FAMILY, API);
	assert.deepEqual(new Destinations({ environment: {} }).for(undefined), [API]);
});

test("an upload to the family's Snapshots API is allowed and one to its interface host is refused", () => {
	const destinations = new Destinations({ environment: {} });
	assert.ok(prepare(API, destinations) instanceof Transfer);
	assert.throws(() => prepare(INTERFACE, destinations), error => {
		assert.deepEqual([error.code, error.status], ['EXPORT_DESTINATION', 403]);
		assert.deepEqual(error.described.details, { origin: INTERFACE, allowed: [API] });
		return true;
	});
});

test('the interface host is allowed only where it is declared', () => {
	const started = new Destinations({ environment: { BEYOND_SNAPSHOTS_ORIGINS: INTERFACE } });
	assert.ok(prepare(INTERFACE, started) instanceof Transfer, 'started with it');

	const plain = new Destinations({ environment: {} });
	assert.ok(prepare(INTERFACE, plain, { snapshots: INTERFACE }) instanceof Transfer, 'declared by the paired page');
	assert.throws(() => prepare(INTERFACE, plain, { snapshots: 'https://other.example' }), error => error.code === 'EXPORT_DESTINATION');

	const configured = new Destinations({ environment: {}, settings: () => [INTERFACE] });
	assert.ok(prepare(INTERFACE, configured) instanceof Transfer, 'in the setting');
});
