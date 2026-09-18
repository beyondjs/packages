import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Context, ContextError } from '../context.mjs';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'beyond context ')));
const write = (file, content) => {
	mkdirSync(dirname(join(root, file)), { recursive: true });
	writeFileSync(join(root, file), typeof content === 'string' ? content : JSON.stringify(content));
};

write('ws/beyond.json', { packages: ['app', 'libs/shared/package.json'] });
write('ws/app/package.json', { name: 'app' });
write('ws/app/main/deep/file.txt', '');
write('ws/libs/shared/package.json', { name: 'shared' });
write('ws/stray/package.json', { name: 'stray' });
write('ws/notes/readme.txt', '');
write('solo/package.json', { name: 'solo' });
write('solo/src/inner/file.txt', '');
write('solo/node_modules/dep/package.json', { name: 'dep' });
write('empty/file.txt', '');
symlinkSync(join(root, 'ws'), join(root, 'link'));

const located = directory => {
	const { root: found, standalone } = new Context({ directory: join(root, directory) });
	return [found.slice(root.length + 1), standalone];
};
const code = options => {
	try {
		new Context(options);
	} catch (error) {
		assert.ok(error instanceof ContextError);
		return error.code;
	}
};

test.after(() => rmSync(root, { recursive: true, force: true }));

test('the nearest workspace file is the context of its declared packages', () => {
	assert.deepEqual(located('ws'), ['ws', false]);
	assert.deepEqual(located('ws/app/main/deep'), ['ws', false]);
	assert.deepEqual(located('ws/libs/shared'), ['ws', false], 'declared through its package.json');
	assert.deepEqual(located('ws/notes'), ['ws', false], 'inside the workspace, outside any package');
});

test('a package without a workspace file is a standalone context', () => {
	assert.deepEqual(located('solo'), ['solo', true]);
	assert.deepEqual(located('solo/src/inner'), ['solo', true]);
	assert.deepEqual(located('solo/node_modules/dep'), ['solo', true], 'an installed dependency is not a project');
});

test('a package below a workspace that does not declare it is not adopted', () => {
	assert.equal(code({ directory: join(root, 'ws/stray') }), 'CONTEXT_NOT_MEMBER');
	const explicit = new Context({ directory: join(root, 'ws/stray'), workspace: join(root, 'ws/stray') });
	assert.equal(explicit.standalone, true);
});

test('explicit roots are exact, and paths are canonical', () => {
	assert.equal(code({ directory: root, workspace: join(root, 'absent') }), 'CONTEXT_WORKSPACE_INVALID');
	assert.equal(code({ directory: root, workspace: join(root, 'empty') }), 'CONTEXT_WORKSPACE_INVALID');
	assert.equal(code({ directory: join(root, 'empty') }), 'CONTEXT_NOT_FOUND');
	assert.equal(new Context({ directory: join(root, 'link/app') }).root, join(root, 'ws'), 'one identity through a symbolic link');
});
