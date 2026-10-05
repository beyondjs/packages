import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Manifests } from '../host/manifests.mjs';

/**
 * A temporary directory holding a workspace root (`ws/`) and directories outside it, removed after the case.
 * The files are small manifests written by the case; their content only has to change size when edited.
 */
const directory = t => {
	const base = realpathSync(mkdtempSync(join(tmpdir(), 'beyond-manifests-')));
	t.after(() => rmSync(base, { recursive: true, force: true }));
	const write = (file, content = '{}') => {
		mkdirSync(dirname(join(base, file)), { recursive: true });
		writeFileSync(join(base, file), content);
	};
	write('ws/package.json', '{"workspaces":["app","../external"]}');
	write('ws/app/package.json', '{"name":"app"}');
	write('external/package.json', '{"name":"external"}');
	return { base, root: join(base, 'ws'), write };
};

// The files of the root that describe its installation, as the host names them (`Execution.LOCK`, `Execution.PATH`)
const FILES = { files: ['beyond-lock.json', '.beyond/execution.json'] };

/**
 * A declaration reader whose members the case changes
 */
const declared = members => {
	const reader = () => ({ kind: 'npm', members: reader.members });
	reader.members = members;
	return reader;
};

test('nothing changed is not a change, however often it is asked', t => {
	const { base, root } = directory(t);
	const manifests = new Manifests(root, declared([{ id: 'app', path: join(root, 'app') }, { id: '../external', path: join(base, 'external') }]), FILES);
	assert.equal(manifests.changed, false);
	assert.equal(manifests.changed, false);
});

test('a manifest of a member outside the root is compared as one inside it', t => {
	const { base, root, write } = directory(t);
	const manifests = new Manifests(root, declared([{ id: 'app', path: join(root, 'app') }, { id: '../external', path: join(base, 'external') }]), FILES);

	write('external/package.json', '{"name":"external","version":"2.0.0"}');
	assert.equal(manifests.changed, true);
	assert.equal(manifests.changed, false, 'one change is reported once');

	write('external/main/module.json', '{"platforms":["web"]}');
	assert.equal(manifests.changed, true, 'a module declared in the external member');
});

test('without the declaration, what is outside the root is not seen: the members are what extends the walk', t => {
	const { root, write } = directory(t);
	const manifests = new Manifests(root);

	write('external/package.json', '{"name":"external","version":"3.0.0"}');
	assert.equal(manifests.changed, false);
	write('ws/app/package.json', '{"name":"app","version":"3.0.0"}');
	assert.equal(manifests.changed, true);
});

test('a member reached through a symbolic link of the root is compared in its real directory', t => {
	const { base, root, write } = directory(t);
	write('linked/package.json', '{"name":"linked"}');
	symlinkSync(join(base, 'linked'), join(root, 'linked'));
	const manifests = new Manifests(root, declared([{ id: 'linked', path: join(base, 'linked') }]), FILES);

	write('linked/package.json', '{"name":"linked","version":"1.0.1"}');
	assert.equal(manifests.changed, true);
});

test('the lock and the execution projection of the root are compared, although the walk skips .beyond', t => {
	const { root, write } = directory(t);
	const manifests = new Manifests(root, declared([]), FILES);

	write('ws/beyond-lock.json', '{"protocol":"beyond-lock/2"}');
	assert.equal(manifests.changed, true, 'a lock that appears');
	write('ws/.beyond/execution.json', '{"protocol":"beyond-execution/1"}');
	assert.equal(manifests.changed, true, 'a projection that appears');
	write('ws/.beyond/execution.json', '{"protocol":"beyond-execution/1","written":"now"}');
	assert.equal(manifests.changed, true, 'a projection written again');
	rmSync(join(root, 'beyond-lock.json'));
	assert.equal(manifests.changed, true, 'a lock that is removed');

	write('ws/.beyond/other.json', '{"unrelated":true}');
	assert.equal(manifests.changed, false, 'nothing else under .beyond is a manifest');
});

test('a member that the declaration adds or removes is a change wherever its directory is', t => {
	const { base, root, write } = directory(t);
	const reader = declared([{ id: 'app', path: join(root, 'app') }]);
	const manifests = new Manifests(root, reader, FILES);

	write('libs/one/package.json', '{"name":"one"}');
	assert.equal(manifests.changed, false, 'a directory nobody declares');

	reader.members = [...reader.members, { id: '../libs/one', path: join(base, 'libs/one') }];
	assert.equal(manifests.changed, true, 'a pattern that now matches it');

	reader.members = reader.members.slice(0, 1);
	assert.equal(manifests.changed, true, 'a pattern that no longer does');
});

test('installed packages and version control below a member are not manifests of the workspace', t => {
	const { base, root, write } = directory(t);
	const manifests = new Manifests(root, declared([{ id: '../external', path: join(base, 'external') }]), FILES);

	write('external/node_modules/dep/package.json', '{"name":"dep"}');
	write('ws/node_modules/dep/package.json', '{"name":"dep"}');
	write('external/.git/package.json', '{}');
	assert.equal(manifests.changed, false);
});

test('a reload for another reason takes the manifests as they are as the reference', t => {
	const { root, write } = directory(t);
	const manifests = new Manifests(root, declared([]), FILES);

	write('ws/.beyond/execution.json', '{"protocol":"beyond-execution/1"}');
	manifests.update();
	assert.equal(manifests.changed, false, 'the projection an installation wrote does not reload the workspace twice');
});

test('a declaration that cannot be read is a state of its own, and reading it again is a change', t => {
	const { root } = directory(t);
	let failing = true;
	const manifests = new Manifests(root, () => {
		if (failing) throw new Error('unreadable root manifest');
		return { kind: 'npm', members: [] };
	}, FILES);

	assert.equal(manifests.changed, false);
	failing = false;
	assert.equal(manifests.changed, true);
});

test('a lock replaced by renaming over it a file of the same size and time is a change', t => {
	const { root, write } = directory(t);
	// One whole second, so both files can carry exactly the same time
	const time = 1700000000;
	const lock = join(root, 'beyond-lock.json');
	write('ws/beyond-lock.json', '{"digest":"sha256-a"}');
	utimesSync(lock, time, time);
	const manifests = new Manifests(root, declared([]), FILES);

	// As an installation writes it: a temporary file renamed over the lock, here with the same size and time,
	// which a filesystem with timestamps of one or two seconds gives a rewrite within one tick
	write('ws/beyond-lock.json.tmp', '{"digest":"sha256-b"}');
	utimesSync(join(root, 'beyond-lock.json.tmp'), time, time);
	renameSync(join(root, 'beyond-lock.json.tmp'), lock);

	assert.equal(statSync(lock).size, '{"digest":"sha256-a"}'.length);
	assert.equal(statSync(lock).mtimeMs, time * 1000);
	assert.equal(manifests.changed, true, 'its inode changed');
});
