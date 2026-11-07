/**
 * The cloud template catalog (`templates/cloud/catalog.json`): its shape, the files of each template and their
 * digest, so a template edited without a new digest and a new catalog version fails here. Read the README of this
 * directory.
 *
 * ```sh
 * node --test tests/templates/catalog.test.mjs
 * ```
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { Catalog } from './support/catalog.mjs';

const catalog = await new Catalog().read();
const exact = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** The platform each kind of CDN target runs on */
const PLATFORMS = { frontend: 'web', backend: 'node' };

/** What each form names as its entry, and the members of every template */
const ENTRIES = { module: 'main', npm: '.' };
const MEMBERS = ['digest', 'directory', 'entry', 'files', 'form', 'kind', 'name', 'package', 'platform', 'title'];

test('the catalog declares its protocol, an exact version and its templates', () => {
	const { document } = catalog;
	assert.deepEqual(Object.keys(document).sort(), ['protocol', 'templates', 'version']);
	assert.equal(document.protocol, Catalog.PROTOCOL);
	assert.match(document.version, exact, 'the catalog version is exact semver');
	assert.ok(Array.isArray(document.templates) && document.templates.length > 0, 'the catalog lists templates');

	const names = document.templates.map(template => template.name);
	assert.equal(new Set(names).size, names.length, 'template names are unique');
	const directories = document.templates.map(template => template.directory);
	assert.equal(new Set(directories).size, directories.length, 'template directories are unique');
});

for (const template of catalog.templates) {
	test(`template "${template.name}": its description`, () => {
		assert.deepEqual(Object.keys(template).sort(), MEMBERS);
		for (const member of MEMBERS.filter(member => member !== 'files')) {
			assert.equal(typeof template[member], 'string', `${member} is a string`);
			assert.ok(template[member].length > 0, `${member} is not empty`);
		}
		assert.match(template.name, /^[a-z][a-z0-9-]*$/);
		assert.match(template.directory, /^[a-z][a-z0-9-]*$/, 'the directory is one plain name under templates/cloud');
		assert.ok(Object.hasOwn(PLATFORMS, template.kind), `the kind is one of ${Object.keys(PLATFORMS)}`);
		assert.equal(template.platform, PLATFORMS[template.kind], `a ${template.kind} runs on ${PLATFORMS[template.kind]}`);
		assert.ok(Object.hasOwn(ENTRIES, template.form), `the form is one of ${Object.keys(ENTRIES)}`);
		assert.equal(template.entry, ENTRIES[template.form], `the ${template.form} form's entry is "${ENTRIES[template.form]}"`);
		assert.match(template.digest, /^sha256:[0-9a-f]{64}$/);
		assert.ok(Array.isArray(template.files) && template.files.includes('package.json'), 'the files include package.json');
		for (const path of template.files) assert.match(path, /^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)*$/, `${path} is a relative path inside the template`);
		assert.equal(new Set(template.files).size, template.files.length, 'no file is listed twice');
	});

	test(`template "${template.name}": its directory holds exactly the listed files`, async () => {
		assert.deepEqual(await catalog.present(template), [...template.files].sort());
	});

	test(`template "${template.name}": its manifest names the package at an exact version`, async () => {
		const manifest = JSON.parse(await readFile(join(catalog.directory(template), 'package.json'), 'utf8'));
		assert.equal(manifest.name, template.package, 'the manifest name is the default package name');
		assert.match(manifest.version, exact, 'the manifest version is exact semver');
		assert.equal(manifest.version, '0.1.0');

		// The form the catalog names is the one the manifest declares
		const declared = manifest.beyond?.publication?.form;
		if (template.form === 'module') assert.equal(declared, 'source', 'a module template is published as sources');
		else assert.equal(declared, undefined, 'an npm template declares no publication form');
	});

	test(`template "${template.name}": the recorded digest is the digest of its files`, async () => {
		const digest = Catalog.digest(await catalog.files(template));
		assert.equal(template.digest, digest, `the files changed: record ${digest} and raise the catalog version`);
	});
}

test('the digest rule: path, byte length and bytes of each file, in the listed order', () => {
	const files = [
		{ path: 'a.txt', bytes: Buffer.from('é') },
		{ path: 'b.txt', bytes: Buffer.from('') }
	];
	// 'é' is two bytes: the length is counted in bytes, not characters
	const expected = createHash('sha256').update(Buffer.from('a.txt\n2\né' + 'b.txt\n0\n', 'utf8')).digest('hex');
	assert.equal(Catalog.digest(files), `sha256:${expected}`);
	assert.notEqual(Catalog.digest(files), Catalog.digest([...files].reverse()), 'the order is part of the digest');
	assert.notEqual(Catalog.digest(files), Catalog.digest([{ ...files[0], path: 'c.txt' }, files[1]]), 'a path is part of the digest');
});
