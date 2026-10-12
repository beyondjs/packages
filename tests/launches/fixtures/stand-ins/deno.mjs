#!/usr/bin/env node
/**
 * Stands for a Deno 2 executable: the unit tests copy it to a directory of their own, make the copy executable and name
 * it as the Deno executable of a service. Asked for `--version`, it answers as Deno 2 does, which the service checks at
 * every launch. Otherwise it reports the arguments and variables it was given and whether the entry module it was asked
 * to run exists, then behaves as a server: it says it listens and ends on SIGTERM.
 */
import { existsSync } from 'node:fs';

const args = process.argv.slice(2);
if (args[0] === '--version') {
	console.log('deno 2.1.4 (stable, release, stand-in)');
	process.exit(0);
}
const [, entry] = args.filter(arg => !arg.startsWith('-')).slice(0, 2);
const variables = { DENO_DIR: process.env.DENO_DIR ?? null, NO_COLOR: process.env.NO_COLOR ?? null, BEE_URL: process.env.BEE_URL ?? null };
console.log(`deno ${JSON.stringify({ args, entry: existsSync(entry ?? '') ? 'exists' : 'missing', directory: existsSync(process.env.DENO_DIR ?? ''), ...variables })}`);
console.log('stand-in listening in deno');
setInterval(() => void 0, 1000);
process.once('SIGTERM', () => process.exit(0));
