import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lstatSync, mkdtempSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Entry } from '../host/exports/entry.mjs';

const directory = t => {
	const path = realpathSync(mkdtempSync(join(tmpdir(), 'beyond entry ')));
	t.after(() => rmSync(path, { recursive: true, force: true }));
	return path;
};

test('a file is read when it is the entry the walk listed', async t => {
	const root = directory(t);
	writeFileSync(join(root, 'a.txt'), 'walked');
	const walked = lstatSync(join(root, 'a.txt'));
	assert.equal((await Entry.read(join(root, 'a.txt'), walked, 'a.txt')).toString(), 'walked');
});

test('a file replaced by a link after the walk is never followed', async t => {
	const root = directory(t);
	writeFileSync(join(root, 'a.txt'), 'walked');
	writeFileSync(join(root, 'secret.txt'), 'outside the package');
	const walked = lstatSync(join(root, 'a.txt'));
	unlinkSync(join(root, 'a.txt'));
	symlinkSync(join(root, 'secret.txt'), join(root, 'a.txt'));
	await assert.rejects(Entry.read(join(root, 'a.txt'), walked, 'a.txt'), error => error.code === 'EXPORT_CHANGED');
});

test('a file replaced by another one after the walk is not archived in its place', async t => {
	const root = directory(t);
	writeFileSync(join(root, 'a.txt'), 'walked');
	const walked = lstatSync(join(root, 'a.txt'));
	writeFileSync(join(root, 'other.txt'), 'another file');
	renameSync(join(root, 'other.txt'), join(root, 'a.txt'));
	await assert.rejects(Entry.read(join(root, 'a.txt'), walked, 'a.txt'), error => error.code === 'EXPORT_CHANGED' && /a\.txt/.test(error.message));

	unlinkSync(join(root, 'a.txt'));
	await assert.rejects(Entry.read(join(root, 'a.txt'), walked, 'a.txt'), error => error.code === 'EXPORT_CHANGED', 'a file that is gone');
});
