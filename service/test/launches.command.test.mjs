import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Command } from '../host/launches/command.mjs';
import { Target } from '../host/launches/target.mjs';

/**
 * How a declared target becomes a launchable one, and the command, directory and environment it runs with
 */

const ORIGIN = 'http://127.0.0.1:4000';
const SETTING = { node: { register: '/toolchain/bee-node/register.mjs', launcher: '/toolchain/cli/src/launcher.mjs' } };

const root = t => {
	const directory = mkdtempSync(join(tmpdir(), 'beyond launches command '));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	return directory;
};

const refusal = (work, code, reason) => assert.throws(work, error => error.code === code && error.details?.reason === reason, `${code} ${reason}`);

test('a resolved backend target is launchable with its entry, its environment and its readiness', () => {
	const nested = Target.of('composition', 'api', {
		declared: { kind: 'backend', runtime: 'node>=22', readiness: { output: 'composition API listening' } },
		entry: { specifier: '@testbed/composition-api/server', vspecifier: '@testbed/composition-api@0.1.0/server' },
		environment: 'node',
		launch: { supported: true }
	});
	assert.deepEqual([nested.specifier, nested.environment, nested.readiness], ['@testbed/composition-api/server', 'node', 'composition API listening']);

	const flat = Target.of('composition', 'worker', { kind: 'backend', runtime: 'deno', specifier: '@testbed/composition-api/worker' });
	assert.deepEqual([flat.environment, flat.readiness], ['deno', undefined]);
	assert.equal(Target.of('a', 'b', { kind: 'backend', specifier: 'x/y' }).environment, 'node', 'node when no runtime is declared');
	assert.equal(Target.of('a', 'b', { kind: 'backend', specifier: 'x/y', readiness: { output: '' } }).readiness, undefined);
});

test('with several local versions of its package, a target launches the versioned specifier the catalog resolved', async t => {
	const resolved = {
		declared: { kind: 'backend', runtime: 'node', selection: '2.0.0' },
		entry: { specifier: '@scope/api/server', vspecifier: '@scope/api@2.0.0/server', package: { name: '@scope/api', version: '2.0.0', source: 'workspace', selected: true } },
		environment: 'node',
		launch: { supported: true, specifier: '@scope/api@2.0.0/server' }
	};
	const versioned = Target.of('app', 'api', resolved);
	assert.equal(versioned.specifier, '@scope/api@2.0.0/server');
	const command = new Command(SETTING, { root: root(t), environment: {}, origin: () => ORIGIN });
	assert.equal((await command.of(versioned)).args.at(-1), '@scope/api@2.0.0/server', 'the version the target selects is the one that runs');

	// A single local version is imported by its public specifier, as the session names it; so is the entry of a catalog
	// that does not say what a launch imports
	assert.equal(Target.of('app', 'api', { ...resolved, launch: { supported: true, specifier: '@scope/api/server' } }).specifier, '@scope/api/server');
	assert.equal(Target.of('app', 'api', { ...resolved, launch: { supported: true } }).specifier, '@scope/api/server');
});

test('a target that is not launchable is refused with its reason', () => {
	refusal(() => Target.of('a', 'web', { declared: { kind: 'frontend' }, entry: { specifier: 'x/main' } }), 'TARGET_NOT_LAUNCHABLE', 'TARGET_FRONTEND');
	refusal(() => Target.of('a', 'b', { declared: {}, entry: { specifier: 'x/y' } }), 'TARGET_NOT_LAUNCHABLE', 'TARGET_KIND_INVALID');
	refusal(() => Target.of('a', 'b', { kind: 'backend', launch: { supported: false, reason: 'TARGET_AMBIGUOUS' } }), 'TARGET_NOT_LAUNCHABLE', 'TARGET_AMBIGUOUS');
	const described = { kind: 'backend', launch: { supported: false, reason: { code: 'TARGET_ENVIRONMENT_UNSUPPORTED', message: 'No output for node' } } };
	assert.throws(() => Target.of('a', 'b', described), { code: 'TARGET_NOT_LAUNCHABLE', message: '"a/b" cannot be launched: No output for node' });
	refusal(() => Target.of('a', 'b', { kind: 'backend' }), 'TARGET_NOT_LAUNCHABLE', 'TARGET_ENTRY_NOT_FOUND');
	for (const runtime of ['bun', 'nodejs', 'denox']) {
		refusal(() => Target.of('a', 'b', { kind: 'backend', runtime, specifier: 'x/y' }), 'TARGET_NOT_LAUNCHABLE', 'TARGET_RUNTIME_UNSUPPORTED');
	}
});

test('a target is resolved by the catalog, whose refusals keep their codes and whose outage is unavailable', async () => {
	await assert.rejects(Target.resolve(undefined, 'a', 'b'), error => error.details?.reason === 'APPLICATIONS_UNAVAILABLE');
	await assert.rejects(Target.resolve({}, 'a', 'b'), error => error.details?.reason === 'APPLICATIONS_UNAVAILABLE');
	const failing = error => ({ resolve: () => Promise.reject(error) });
	await assert.rejects(Target.resolve(failing(Object.assign(new Error('no b'), { code: 'TARGET_NOT_FOUND' })), 'a', 'b'), { code: 'TARGET_NOT_FOUND', status: 404 });
	await assert.rejects(Target.resolve(failing(Object.assign(new Error('no a'), { code: 'APPLICATION_NOT_FOUND' })), 'a', 'b'), { code: 'APPLICATION_NOT_FOUND', status: 404 });
	await assert.rejects(Target.resolve(failing(Object.assign(new Error('reloading'), { code: 'UNAVAILABLE' })), 'a', 'b'), { code: 'UNAVAILABLE', status: 503 });
	await assert.rejects(Target.resolve(failing(new Error('a defect')), 'a', 'b'), { message: 'a defect' });
	const target = await Target.resolve({ resolve: async () => ({ kind: 'backend', specifier: 'x/y' }) }, 'a', 'b');
	assert.equal(target.specifier, 'x/y');
});

test('Node runs the launcher under the registration, with the loader of the service and without its own variables', async t => {
	const environment = {
		PATH: '/usr/bin',
		GITHUB_TOKEN: 'the person\'s own',
		BEYOND_HOST_OPTIONS: '{"token":"x"}',
		BEYOND_SERVICE_OPTIONS: '{}',
		BEYOND_AUTHORITY: '{}',
		BEYOND_ENVIRONMENT: 'env-1',
		BEYOND_TRUST_LOOPBACK: '1',
		BEYOND_SNAPSHOTS_TOKEN: 'secret',
		BEYOND_UPLOAD_KEY: 'secret',
		BEYOND_HOME: '/home/beyond',
		BEE_URL: 'http://127.0.0.1:1112,http://127.0.0.1:1120',
		BEE_ADAPTER: 'engine',
		BEE_IMPORT_MAP: 'bootstrap.json'
	};
	const variables = { LAUNCH_VARIABLE: 'kept', BEE_ADAPTER: 'engine', 'not-a-name': 'dropped', NUMBER: 7, NODE_OPTIONS: '--require=elsewhere', LD_PRELOAD: 'x.so', DYLD_INSERT_LIBRARIES: 'x.dylib', NODE_PATH: '/elsewhere', BEYOND_DENO: '/elsewhere/deno', DENO_DIR: '/elsewhere' };
	const settings = () => ({ value: key => (key === 'targets.app.api.environment' ? variables : void 0) });
	const directory = root(t);
	const command = new Command(SETTING, { root: directory, environment, settings, origin: () => ORIGIN });
	const run = await command.of(new Target({ application: 'app', target: 'api', specifier: '@scope/api/server', environment: 'node' }));

	assert.equal(run.executable, process.execPath);
	assert.deepEqual(run.args, ['--import', pathToFileURL(SETTING.node.register).href, SETTING.node.launcher, '@scope/api/server']);
	assert.equal(run.cwd, directory);
	assert.deepEqual(run.env, { PATH: '/usr/bin', GITHUB_TOKEN: 'the person\'s own', BEYOND_HOME: '/home/beyond', LAUNCH_VARIABLE: 'kept', BEE_URL: ORIGIN, BEE_ADAPTER: 'packages', BEE_IMPORT_MAP: '' });
	// The reserved names the settings file holds are left out, and each one is said
	const ignored = ['BEE_ADAPTER', 'NODE_OPTIONS', 'LD_PRELOAD', 'DYLD_INSERT_LIBRARIES', 'NODE_PATH', 'BEYOND_DENO', 'DENO_DIR'];
	assert.deepEqual(run.diagnostics.map(({ code, name }) => [code, name]), ignored.map(name => ['LAUNCH_VARIABLE_IGNORED', name]));

	// File URLs are accepted as the setting gives them
	const urls = { node: { register: pathToFileURL('/a/register.mjs').href, launcher: pathToFileURL('/a/launcher.mjs').href } };
	const given = await new Command(urls, { root: directory, environment: {}, origin: () => ORIGIN }).of(new Target({ application: 'a', target: 'b', specifier: 'x/y', environment: 'node' }));
	assert.deepEqual(given.args.slice(0, 3), ['--import', 'file:///a/register.mjs', '/a/launcher.mjs']);
	assert.equal(Command.valid(urls), true);
	assert.equal(Command.valid({ node: { register: 'register.mjs', launcher: '/a/launcher.mjs' } }), false);
	assert.equal(Command.valid({ deno: {} }), false);
});

test('Deno runs the entry of this feature with the import map of the service, from the executable configured first', async t => {
	const directory = root(t);
	const target = new Target({ application: 'app', target: 'worker', specifier: '@scope/api/worker', environment: 'deno' });
	const values = {};
	const settings = () => ({ value: key => values[key] });
	// The check of a Deno executable, as the settings feature checks one: these paths stand for checked executables
	const checked = [];
	const executable = { verify: async path => (checked.push(path), {}) };
	const command = (setting, environment = {}) => new Command(setting, { root: directory, environment, settings, origin: () => ORIGIN, executable });

	await assert.rejects(command(SETTING).of(target), error => error.status === 422 && error.details.reason === 'DENO_NOT_CONFIGURED');
	assert.equal((await command(SETTING, { BEYOND_DENO: '/env/deno' }).of(target)).executable, '/env/deno');
	values['launch.deno'] = '/settings/deno';
	assert.equal((await command(SETTING, { BEYOND_DENO: '/env/deno' }).of(target)).executable, '/settings/deno');
	const run = await command({ ...SETTING, deno: { executable: '/setting/deno' } }, { BEYOND_DENO: '/env/deno', BEE_URL: 'engine' }).of(target);
	assert.equal(run.executable, '/setting/deno');

	assert.deepEqual(checked, ['/env/deno', '/settings/deno', '/setting/deno'], 'the executable is checked at every launch');

	const cache = join(directory, '.beyond', 'launches', 'deno');
	assert.deepEqual(run.args, [
		'run',
		'--no-config',
		'--no-lock',
		'--allow-net',
		'--allow-import',
		'--allow-env',
		`--reload=${ORIGIN}/`,
		`--import-map=${ORIGIN}/importmap.json?target=node&format=esm`,
		Command.ENTRY,
		'@scope/api/worker'
	]);
	assert.equal(existsSync(Command.ENTRY), true);
	assert.deepEqual([run.cwd, run.env.DENO_DIR, run.env.NO_COLOR, run.env.BEE_URL], [directory, cache, '1', undefined]);
	assert.equal(existsSync(cache), true, 'the cache directory is created in the workspace');
	assert.equal(readFileSync(join(directory, '.beyond', '.gitignore'), 'utf8'), '*\n', 'in the state directory, which Git ignores');
});

test('a Deno executable the check refuses is not launched, whichever source names it', async t => {
	const directory = root(t);
	const target = new Target({ application: 'app', target: 'worker', specifier: '@scope/api/worker', environment: 'deno' });
	const executable = { verify: async path => ({ message: `"${path}" is Deno 1.46.3, and Deno 2 is required` }) };
	const command = new Command(SETTING, { root: directory, environment: { BEYOND_DENO: '/env/deno' }, origin: () => ORIGIN, executable });
	await assert.rejects(command.of(target), error => {
		assert.deepEqual([error.status, error.code, error.details.reason], [422, 'TARGET_NOT_LAUNCHABLE', 'DENO_INVALID']);
		assert.match(error.message, /"\/env\/deno" is Deno 1\.46\.3/);
		return true;
	});
	assert.equal(existsSync(join(directory, '.beyond')), false, 'nothing is created for a launch that does not run');
});

test('nothing is launched before the service listens', async () => {
	const command = new Command(SETTING, { root: '/work', environment: {}, origin: () => void 0 });
	await assert.rejects(command.of(new Target({ application: 'a', target: 'b', specifier: 'x/y', environment: 'node' })), { code: 'UNAVAILABLE', status: 503 });
});
