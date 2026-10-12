/**
 * The entry document of a web export, `index.html`: the import map of the page, the stylesheets the document links and
 * the import of the entry module, which runs its top-level code once, as the preview's document does. It differs from
 * the preview's in what it leaves out: no development runtime is registered, nothing connects to a development
 * service, no diagnostic of a build is written into it, and every address is the export's own (under `base`) or the
 * CDN's, pinned by its integrity.
 *
 * The loader is the browser's: ES modules resolved through the native import map, which every current engine supports.
 * The runtime a composed module imports (`<runtime>/bundle`) is a module of the page like any other, written beside
 * it.
 *
 * ```js
 * const html = new Page({ title, entry: '@scope/app/main', importmap, links }).html;
 * ```
 */
export class Page {
	#title;
	#entry;
	#importmap;
	#links;

	/**
	 * @param {{title: string, entry: string, importmap: object, links: {href: string, module: string, integrity?:
	 * string}[]}} specs
	 */
	constructor({ title, entry, importmap, links }) {
		this.#title = title;
		this.#entry = entry;
		this.#importmap = importmap;
		this.#links = links;
	}

	/**
	 * JSON that can be written inside a script element
	 */
	static #json(value, indent) {
		return JSON.stringify(value, null, indent).replace(/</g, '\\u003c');
	}

	static #text(value) {
		return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	}

	get html() {
		const links = this.#links.map(({ href, module, integrity }) => {
			const pinned = integrity ? ` integrity="${Page.#text(integrity)}" crossorigin="anonymous"` : '';
			return `<link rel="stylesheet" data-beyond-styles="${Page.#text(module)}" href="${Page.#text(href)}"${pinned}>`;
		});
		return [
			'<!doctype html>',
			'<html lang="en">',
			'<head>',
			'<meta charset="utf-8">',
			'<meta name="viewport" content="width=device-width, initial-scale=1">',
			'<link rel="icon" href="data:,">',
			`<title>${Page.#text(this.#title)}</title>`,
			`<script type="importmap">\n${Page.#json(this.#importmap, '\t')}\n</script>`,
			...links,
			'</head>',
			'<body>',
			`<script type="module">\nimport ${Page.#json(this.#entry)};\n</script>`,
			'</body>',
			'</html>',
			''
		].join('\n');
	}
}
