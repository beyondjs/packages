import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Exports } from '../host/exports/exports.mjs';
import { tar, workspace } from './support/exports.mjs';

const archive = (root, id, index) => join(root, '.beyond', 'exports', id, `${index}.tar`);
const names = file => tar(file).entries.map(({ name }) => name);
const write = (root, path, content) => {
	mkdirSync(join(root, path, '..'), { recursive: true });
	writeFileSync(join(root, path), content);
};

test('equal sources give equal archives: twice, and after the service starts again', async t => {
	const root = workspace(t);
	const first = await new Exports(root).create(['.', 'packages/widgets', 'packages/plain']);
	const second = await new Exports(root).create(['.', 'packages/widgets', 'packages/plain']);
	assert.equal(first.state, 'ready');
	assert.notEqual(first.id, second.id);
	const digests = record => record.packages.map(({ digest, bytes }) => [digest, bytes]);
	assert.deepEqual(digests(second), digests(first));
	first.packages.forEach(({ digest }) => assert.match(digest, /^[0-9a-f]{64}$/));

	const restarted = new Exports(root);
	await restarted.start();
	t.after(() => restarted.stop());
	assert.deepEqual(digests(await restarted.get(first.id)), digests(first), 'the record survives');
	assert.deepEqual(digests(await restarted.create(['.', 'packages/widgets', 'packages/plain'])), digests(first));

	// A changed source changes only the archive of its package
	writeFileSync(join(root, 'packages/plain/index.js'), "export default 'changed';\n");
	const changed = digests(await restarted.create(['.', 'packages/widgets', 'packages/plain']));
	assert.deepEqual(changed.slice(0, 2), digests(first).slice(0, 2));
	assert.notDeepEqual(changed[2], digests(first)[2]);
});

test('an archive is a reproducible ustar: sorted entries, no time, no owner, normalized modes, valid checksums', async t => {
	const root = workspace(t);
	const created = await new Exports(root).create(['.']);
	const file = archive(root, created.id, 0);
	const { entries, checksums, end } = tar(file);
	assert.ok(checksums, 'every header checksum is right');
	assert.ok(end, 'two zero blocks end it');
	entries.forEach(entry => {
		assert.deepEqual([entry.mtime, entry.uid, entry.gid], [0, 0, 0], entry.name);
		assert.ok(entry.type === '5' ? entry.mode === 0o755 : [0o644, 0o755].includes(entry.mode), entry.name);
	});
	assert.equal(entries.find(({ name }) => name === 'scripts/run.sh').mode, 0o755, 'executable for its owner');
	assert.equal(entries.find(({ name }) => name === 'README.md').mode, 0o644);
	assert.equal(created.packages[0].bytes, readFileSync(file).length);

	// A long path travels in a pax record, which a standard reader understands
	const long = `src/${'deep/'.repeat(20)}long-name.ts`;
	assert.ok(names(file).includes(long));
	assert.ok(execFileSync('tar', ['-tf', file], { encoding: 'utf8' }).split('\n').includes(long), 'the system tar lists it');
	assert.deepEqual(names(file).filter(name => !name.endsWith('/')), created.packages[0].files, 'the export lists what the archive holds');
});

test('the root package holds its own files: never dependencies, internals, secrets, links or other packages', async t => {
	const root = workspace(t);
	const created = await new Exports(root).create(['.']);
	const listed = names(archive(root, created.id, 0));
	for (const kept of ['.env.example', 'README.md', 'package.json', 'src/index.ts', 'tools/package.json', '.docker/README.md', 'scripts/run.sh']) {
		assert.ok(listed.includes(kept), `keeps ${kept}`);
	}
	assert.ok(!listed.some(name => name.startsWith('packages/')), 'no directory of another package, not even empty');

	const [described] = created.packages;
	assert.deepEqual(described.excluded, {
		ignored: [],
		secrets: ['.docker/config.json', '.env', '.env.local', '.npmrc', '.ssh/', 'id_rsa', 'server.pem'],
		links: ['linked', 'outside'],
		members: ['packages/plain/', 'packages/widgets/'],
		internal: ['.beyond/', '.git/', 'node_modules/']
	});
	assert.deepEqual([described.path, described.name, described.version, described.manifest.name], ['.', '@fixture/root', '1.0.0', '@fixture/root']);
	assert.equal(JSON.stringify(created).includes('not a real secret'), false, 'what was left out is named, never read');
});

test('a member leaves out the members inside it, its dependencies and its own secrets', async t => {
	const root = workspace(t);
	const created = await new Exports(root).create(['packages/widgets', 'packages/widgets/demo']);
	assert.deepEqual(names(archive(root, created.id, 0)), ['package.json', 'src/', 'src/widget.ts']);
	const { excluded } = created.packages[0];
	assert.deepEqual([excluded.members, excluded.secrets, excluded.internal], [['demo/'], ['.env'], ['node_modules/']]);
	assert.deepEqual(names(archive(root, created.id, 1)), ['index.ts', 'package.json']);
	assert.deepEqual(created.packages.map(({ name, version }) => `${name}@${version}`), ['@fixture/widgets@1.2.0', '@fixture/demo@0.1.0']);
});

test('without "files", the ignore files decide as Git does, .npmignore over .gitignore, and npm\'s own exclusions apply', async t => {
	const root = workspace(t, { additions: false });
	write(root, '.gitignore', 'dist/\n*.log\n!keep.log\n');
	write(root, 'dist/out.js', 'built\n');
	write(root, 'debug.log', 'log\n');
	write(root, 'keep.log', 'kept\n');
	write(root, 'src/.gitignore', 'generated.ts\n');
	write(root, 'src/generated.ts', 'generated\n');
	write(root, 'package-lock.json', '{}\n');
	write(root, '.DS_Store', 'x');
	write(root, 'packages/plain/.gitignore', 'index.js\n');
	write(root, 'packages/plain/.npmignore', 'notes.txt\n');
	write(root, 'packages/plain/notes.txt', 'notes\n');

	const created = await new Exports(root).create(['.', 'packages/plain']);
	const [rooted, plain] = created.packages;
	assert.ok(rooted.files.includes('keep.log') && rooted.files.includes('src/index.ts'), JSON.stringify(rooted.files));
	assert.deepEqual(rooted.excluded.ignored, ['.DS_Store', '.gitignore', 'debug.log', 'dist/', 'package-lock.json', 'src/.gitignore', 'src/generated.ts']);
	assert.deepEqual(plain.files, ['index.js', 'package.json'], 'its .npmignore decides, not its .gitignore');
	assert.deepEqual(plain.excluded.ignored, ['.gitignore', '.npmignore', 'notes.txt']);
});

test('with "files", the archive holds what they name, with the manifest, readme and license always', async t => {
	const root = workspace(t, { additions: false });
	const manifest = { name: '@fixture/plain', version: '2.0.0', files: ['dist', 'types/*.d.ts', '!dist/test'] };
	write(root, 'packages/plain/package.json', JSON.stringify(manifest));
	for (const path of ['dist/index.js', 'dist/test/spec.js', 'types/index.d.ts', 'types/notes.md', 'README.md', 'LICENSE', 'src/index.ts', 'nested/dist/x.js']) {
		write(root, `packages/plain/${path}`, `${path}\n`);
	}
	const [plain] = (await new Exports(root).create(['packages/plain'])).packages;
	assert.deepEqual(plain.files, ['LICENSE', 'README.md', 'dist/index.js', 'package.json', 'types/index.d.ts']);
	assert.deepEqual(plain.excluded.ignored.sort(), ['dist/test/spec.js', 'index.js', 'nested/dist/x.js', 'src/index.ts', 'types/notes.md']);
});

test('the secrets of every kind are left out, and named', async t => {
	const root = workspace(t, { additions: false });
	const secrets = ['.yarnrc.yml', '.yarnrc', 'terraform.tfstate', 'terraform.tfstate.backup', 'local.sqlite', 'app.db', 'key.p8', 'site.crt', '.idea/workspace.xml', '.vscode/settings.json', '.pypirc'];
	for (const path of secrets) write(root, `packages/plain/${path}`, 'not a real secret\n');
	const [plain] = (await new Exports(root).create(['packages/plain'])).packages;
	assert.deepEqual(plain.files, ['index.js', 'package.json']);
	assert.deepEqual(plain.excluded.secrets, ['.idea/', '.pypirc', '.vscode/', '.yarnrc', '.yarnrc.yml', 'app.db', 'key.p8', 'local.sqlite', 'site.crt', 'terraform.tfstate', 'terraform.tfstate.backup']);
});

test('a path that is neither "." nor a member inside the root is EXPORT_PACKAGE_INVALID, and nothing is written', async t => {
	const root = workspace(t);
	const exports = new Exports(root);
	const invalid = ['..', '../outside', '/etc', 'packages/widgets/', './packages/plain', 'packages//plain', 'tools', 'packages', 'node_modules/dependency', 'missing', 'linked', 'packages\\plain', ''];
	for (const path of invalid) {
		await assert.rejects(exports.create([path]), error => error.code === 'EXPORT_PACKAGE_INVALID' && error.status === 400, path);
	}
	for (const paths of [[], 'packages/plain', ['packages/plain', 'packages/plain'], Array.from({ length: 51 }, () => '.')]) {
		await assert.rejects(exports.create(paths), error => error.code === 'EXPORT_PACKAGE_INVALID', JSON.stringify(paths).slice(0, 40));
	}
	assert.deepEqual(await exports.list(), []);
});

test('a package without a manifest that names it and its version is refused', async t => {
	const root = workspace(t);
	writeFileSync(join(root, 'packages/plain/package.json'), '{"name": "@fixture/plain"}');
	await assert.rejects(new Exports(root).create(['packages/plain']), error => error.code === 'EXPORT_PACKAGE_INVALID' && /version/.test(error.message));
});

test('a package past the bounds fails the export with EXPORT_TOO_LARGE, and its archives are not kept', async t => {
	const root = workspace(t);
	for (const limits of [{ files: 3 }, { bytes: 4096 }]) {
		const failed = await new Exports(root, { limits }).create(['packages/plain', '.']);
		assert.equal(failed.state, 'failed', JSON.stringify(limits));
		assert.equal(failed.error.code, 'EXPORT_TOO_LARGE');
		assert.equal(failed.packages[1].error.code, 'EXPORT_TOO_LARGE');
		assert.ok(!existsSync(archive(root, failed.id, 0)) && !existsSync(archive(root, failed.id, 1)), 'no archive is kept');
		assert.equal((await new Exports(root).get(failed.id)).state, 'failed', 'the failure is recorded');
	}
});

test('exports are kept under .beyond, which ignores itself, and expire after the retention', async t => {
	const root = workspace(t, { additions: false });
	let now = Date.parse('2026-10-10T12:00:00Z');
	const clock = () => now;
	const exports = new Exports(root, { clock, environment: { BEYOND_EXPORT_RETENTION: '60000' } });
	const created = await exports.create(['packages/plain']);
	assert.equal(readFileSync(join(root, '.beyond', '.gitignore'), 'utf8'), '*\n');
	assert.equal(Date.parse(created.expires) - Date.parse(created.created), 60000);
	assert.deepEqual((await exports.list()).map(({ id }) => id), [created.id]);

	now += 60000;
	await assert.rejects(exports.get(created.id), error => error.code === 'EXPORT_NOT_FOUND' && error.status === 404);
	assert.deepEqual(await exports.list(), []);
	assert.ok(existsSync(join(root, '.beyond', 'exports', created.id)), 'still on disk until it is swept');
	await exports.sweep();
	assert.ok(!existsSync(join(root, '.beyond', 'exports', created.id)));

	// The start of a service sweeps as well
	const later = await exports.create(['packages/plain']);
	now += 60000;
	const restarted = new Exports(root, { clock, environment: { BEYOND_EXPORT_RETENTION: '60000' } });
	await restarted.start();
	t.after(() => restarted.stop());
	assert.ok(!existsSync(join(root, '.beyond', 'exports', later.id)));
});

test('the allowed Snapshots origins are https, or http on a loopback name, and anything else fails the start', () => {
	assert.deepEqual(Exports.origins({}), []);
	assert.deepEqual(Exports.origins({ BEYOND_SNAPSHOTS_ORIGINS: 'https://snapshots.example, http://127.0.0.1:5300/, http://localhost:5301' }), ['https://snapshots.example', 'http://127.0.0.1:5300', 'http://localhost:5301']);
	assert.throws(() => Exports.origins({ BEYOND_SNAPSHOTS_ORIGINS: 'snapshots' }), /not an origin/);
	assert.throws(() => Exports.origins({ BEYOND_SNAPSHOTS_ORIGINS: 'http://snapshots.example' }), /neither an https origin nor an http one on a loopback name/);
	assert.throws(() => Exports.origins({ BEYOND_SNAPSHOTS_ORIGINS: 'ftp://snapshots.example' }), /neither/);
});
