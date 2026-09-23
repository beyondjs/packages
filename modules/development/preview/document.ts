import type { IPreviewDescription } from './index';

/**
 * The entry document of a preview: an import map and the import of the entry module.
 *
 * Every address of this environment is relative to the document, and nothing in it is a credential: what
 * authorizes a visitor is decided in front of this service, which only ever sees the grant of the request.
 * Importing the entry module runs its top-level code once, which is what executing a public module means;
 * no exported function is called. When the workspace or the CDN provides a development runtime, the
 * document registers this service in it first, so that the runtime applies the updates the service
 * announces. It gives the runtime the part of the session it needs — the modules in development and the
 * options of their updates — so the runtime never reads `/session`, which a visitor's grant does not
 * allow. The document applies no update by itself, and it never reloads.
 */
export class Document {
	#description: IPreviewDescription;

	constructor(description: IPreviewDescription) {
		this.#description = description;
	}

	/**
	 * JSON that can be written inside a script element
	 */
	#json(value: unknown, indent?: string): string {
		return JSON.stringify(value, null, indent).replace(/</g, '\\u003c');
	}

	#text(value: string): string {
		return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	}

	get #script(): string {
		const { entry, updates, diagnostics } = this.#description;
		const lines = diagnostics.map(({ code, message }) => `console.error(${this.#json(`[beyond preview] ${code}: ${message}`)});`);

		if (updates.runtime) {
			lines.push(
				'try {',
				`\tconst { local } = await import(${this.#json(updates.runtime)});`,
				`\tawait local.register({ origin: new URL('..', document.baseURI).href, options: ${this.#json(updates.session.options)}, session: ${this.#json(updates.session)} });`,
				'} catch (error) {',
				`\tconsole.error('[beyond preview] The development runtime could not connect, so updates are not applied:', error);`,
				'}'
			);
		}
		lines.push(`await import(${this.#json(entry.specifier)});`);
		return lines.join('\n');
	}

	/**
	 * The stylesheets the document holds: those of the modules that are not widgets and that the entry
	 * reaches without crossing a widget, and the ones those modules select by specifier (`pkg/sub.css`),
	 * linked and marked with the module they belong to, which is how the development runtime replaces them
	 * when a build changes them. A stylesheet reached through a widget only is adopted inside the root of
	 * that widget.
	 */
	get #links(): string[] {
		const held = this.#description.modules.filter(module => !module.widget && module.scope !== 'widget');
		const sheets = held.flatMap(module => [
			...(module.styles ? [{ vspecifier: module.vspecifier ?? module.specifier, url: module.styles }] : []),
			...(module.stylesheets ?? [])
		]);

		// A stylesheet that several modules select, or that a module owns and another selects, is linked once
		const linked = new Map(sheets.map(sheet => [sheet.url, sheet]));
		return [...linked.values()].map(({ vspecifier, url }) => `<link rel="stylesheet" data-beyond-styles="${this.#text(vspecifier)}" href="${this.#text(url)}">`);
	}

	get html(): string {
		const { entry, importmap } = this.#description;
		return [
			'<!doctype html>',
			'<html lang="en">',
			'<head>',
			'<meta charset="utf-8">',
			'<meta name="viewport" content="width=device-width, initial-scale=1">',
			'<meta name="referrer" content="no-referrer">',
			// Without it a browser asks the root of the origin for an icon, which is outside the base of the preview
			'<link rel="icon" href="data:,">',
			`<title>${this.#text(entry.specifier)}</title>`,
			`<script type="importmap">\n${this.#json(importmap, '\t')}\n</script>`,
			...this.#links,
			'</head>',
			'<body>',
			`<script type="module">\n${this.#script}\n</script>`,
			'</body>',
			'</html>',
			''
		].join('\n');
	}
}
