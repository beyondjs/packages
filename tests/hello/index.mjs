import assert from 'node:assert/strict';
import { hello } from '@beyond-js/packages/hello';
import { message } from '@beyond-js/packages/hello/message';

const response = await fetch(new URL('hello.js', process.env.BEE_URL), { signal: AbortSignal.timeout(10000) });
assert.equal(response.status, 200);
assert.match(response.headers.get('content-type'), /javascript/);
const code = await response.text();
assert.match(code, /import \* as \w+ from '@beyond-js\/packages\/hello\/message'/);
assert.match(code, /import \* as \w+ from '@beyond-js\/kernel\/bundle'/);

assert.equal(hello(), 'Hello from Beyond!');
assert.equal(hello(), message);
console.log('PASS: Engine → HTTP ESM → BEE Node; public module dependency resolved.');
