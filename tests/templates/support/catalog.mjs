/**
 * The cloud template catalog of this repository (`templates/cloud/catalog.json`, `beyond-cloud-templates/1`) as the
 * validations read it: the document, the directory of each template, its files and their digest.
 */
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join, posix, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export class Catalog {
	static ROOT = fileURLToPath(new URL('../../../templates/cloud/', import.meta.url));
	static PROTOCOL = 'beyond-cloud-templates/1';

	/**
	 * The digest of a template: SHA-256 over its files in the listed order, each as `<path>\n<byte length>\n<bytes>`
	 *
	 * @param {{path: string, bytes: Uint8Array}[]} files
	 * @returns {string} `sha256:<hex>`
	 */
	static digest(files) {
		const hash = createHash('sha256');
		for (const { path, bytes } of files) {
			hash.update(`${path}\n${bytes.byteLength}\n`);
			hash.update(bytes);
		}
		return `sha256:${hash.digest('hex')}`;
	}

	#document;

	get document() {
		return this.#document;
	}

	get templates() {
		return this.#document.templates;
	}

	async read() {
		this.#document = JSON.parse(await readFile(join(Catalog.ROOT, 'catalog.json'), 'utf8'));
		return this;
	}

	directory(template) {
		return join(Catalog.ROOT, template.directory);
	}

	/**
	 * The files of a template in the order the catalog lists them, with their bytes
	 */
	async files(template) {
		const directory = this.directory(template);
		return Promise.all(template.files.map(async path => ({ path, bytes: await readFile(join(directory, ...path.split('/'))) })));
	}

	/**
	 * Every file the template's directory holds, relative to it with forward slashes, sorted
	 */
	async present(template) {
		const directory = this.directory(template);
		const entries = await readdir(directory, { withFileTypes: true, recursive: true });
		return entries
			.filter(entry => !entry.isDirectory())
			.map(entry => relative(directory, join(entry.parentPath ?? entry.path, entry.name)).split(sep).join(posix.sep))
			.sort();
	}
}
