import { test } from 'node:test';

test('never ends', () => new Promise(() => setInterval(() => {}, 1000)));
