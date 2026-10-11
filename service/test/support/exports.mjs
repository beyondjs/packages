import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURE = fileURLToPath(new URL('../fixtures/exports/workspace', import.meta.url));

/**
 * A copy of the export fixture (`fixtures/exports/workspace`) in a unique temporary directory, removed when the case
 * ends, with what a checked-in fixture cannot hold written into the copy: the directories every archive leaves out,
 * files named as secrets, an executable file, a path longer than a ustar name and symbolic links.
 *
 * ```js
 * const root = workspace(t);                      // the canonical root of the copy
 * const root = workspace(t, { additions: false }); // the fixture as it is
 * ```
 *
 * @param {import('node:test').TestContext} t
 * @param {{additions?: boolean}} [options]
 */
export const workspace = (t, { additions = true } = {}) => {
	const parent = realpathSync(mkdtempSync(join(tmpdir(), 'beyond exports ')));
	t.after(() => rmSync(parent, { recursive: true, force: true }));
	const root = join(parent, 'workspace');
	cpSync(FIXTURE, root, { recursive: true });
	if (!additions) return root;

	const write = (path, content) => {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), content);
	};
	write('node_modules/dependency/index.js', 'module.exports = 1;\n');
	write('packages/widgets/node_modules/dependency/index.js', 'module.exports = 1;\n');
	write('.git/HEAD', 'ref: refs/heads/main\n');
	write('.beyond/development/selection.json', '{}\n');
	for (const secret of ['.env', '.env.local', 'id_rsa', 'server.pem', '.npmrc', '.ssh/config', '.docker/config.json', 'packages/widgets/.env']) write(secret, 'not a real secret\n');
	write('.docker/README.md', 'kept: only config.json is a secret here\n');
	write('scripts/run.sh', '#!/bin/sh\necho run\n');
	chmodSync(join(root, 'scripts/run.sh'), 0o755);
	write(`src/${'deep/'.repeat(20)}long-name.ts`, 'export const deep = true;\n');
	symlinkSync('src', join(root, 'linked'));
	symlinkSync('/', join(root, 'outside'));
	return root;
};

/**
 * The entries of a tar archive as its headers say them, read without a library: name (with a pax `path` record
 * applied), type, mode, size, owner, group and modification time, and whether every checksum is right
 *
 * @param {string} file
 * @returns {{entries: {name: string, type: string, mode: number, size: number, uid: number, gid: number, mtime: number}[], checksums: boolean, end: boolean}}
 */
export const tar = file => {
	const bytes = readFileSync(file);
	const field = (block, offset, length) => block.subarray(offset, offset + length).toString('utf8').replace(/\0.*$/s, '');
	const octal = (block, offset, length) => parseInt(field(block, offset, length).trim() || '0', 8);
	const entries = [];
	let checksums = true;
	let pending;
	let offset = 0;
	for (; offset + 512 <= bytes.length; ) {
		const block = bytes.subarray(offset, offset + 512);
		if (block.every(byte => byte === 0)) break;
		const sum = [...block].reduce((total, byte, index) => total + (index >= 148 && index < 156 ? 32 : byte), 0);
		checksums &&= sum === octal(block, 148, 8);
		const size = octal(block, 124, 12);
		const type = field(block, 156, 1);
		const body = bytes.subarray(offset + 512, offset + 512 + size);
		offset += 512 + Math.ceil(size / 512) * 512;
		if (type === 'x') {
			pending = /\d+ path=(.*)\n/.exec(body.toString('utf8'))?.[1];
			continue;
		}
		entries.push({ name: pending ?? field(block, 0, 100), type, mode: octal(block, 100, 8), size, uid: octal(block, 108, 8), gid: octal(block, 116, 8), mtime: octal(block, 136, 12) });
		pending = void 0;
	}
	const end = bytes.length === offset + 1024 && bytes.subarray(offset).every(byte => byte === 0);
	return { entries, checksums, end };
};
