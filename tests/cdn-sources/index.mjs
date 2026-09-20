/**
 * Validation of the second stage of a published build: every package of a pinned graph is fetched,
 * verified and published atomically into a store, within bounds, and nothing else is. Run under BEE Node
 * with the bootstrap Engine serving the implementation.
 */
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Resolution } from '@beyond-js/packages/resolution';
import { FilesystemStore } from '@beyond-js/packages/sources';
import { FakeRegistry } from '../cdn-resolution/registry.mjs';
import { summary } from '../cdn-resolution/harness.mjs';
import { fixtures } from './fixtures.mjs';
import { fetching } from './fetch.mjs';
import { refusals } from './refusals.mjs';
import { tenancy } from './tenancy.mjs';

const registry = await new FakeRegistry({ prefix: '/npm' }).start();
await fixtures(registry);

const root = await mkdtemp(join(tmpdir(), 'beyond-cdn-sources-'));
const store = new FilesystemStore(join(root, 'store'));

// Stages that were neither published nor discarded
const staged = () => readdir(join(store.root, '.staging')).catch(() => []);
const pin = params => Resolution.pin({ providers: { values: { default: { registry: registry.url } } }, ...params });

try {
	await fetching({ registry, pin, store, staged });
	await refusals({ registry, pin, store, staged });
	await tenancy({ registry, pin, store, staged });
} finally {
	await registry.stop();
	await rm(root, { recursive: true, force: true });
}
summary();
