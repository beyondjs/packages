import { core } from './index.js';

// An adapter for one runtime: evaluating it outside that runtime throws, as `hono/bun` does with `Bun`
const host = globalThis.FixtureRuntime.name;
export const adapter = () => `${host}:${core()}`;
