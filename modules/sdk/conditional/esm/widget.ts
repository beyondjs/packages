import type { IDiagnostic } from '@beyond-js/packages/types';

/**
 * What a widget module declares in its manifest, under `widget`:
 *
 * ```json
 * { "widget": { "element": { "name": "app-hello", "attrs": ["subject"] }, "render": { "ssr": false } } }
 * ```
 *
 * `is`, `route` and `layout` describe pages and layouts of an application, as the Widgets runtime defines
 * them; an ordinary custom element declares none of them.
 */
export /*bundle*/ interface IWidgetDeclaration {
	element: { name: string; attrs?: string[] };
	is?: 'page' | 'layout';
	route?: string;
	layout?: string;
	render?: { csr?: boolean; ssr?: boolean; sr?: boolean; multilanguage?: boolean };
}

/**
 * The registration of a widget, as the artifact gives it to the Widgets runtime
 */
export /*bundle*/ interface IWidgetSpecs {
	name: string;
	vspecifier: string;
	attrs?: string[];
	is?: string;
	route?: string;
	layout?: string;

	/**
	 * Whether the package of the widget publishes a shared `global` stylesheet that every widget of the
	 * package adopts in its root
	 */
	global?: boolean;
	render: { csr: boolean; ssr: boolean; sr: boolean; multilanguage?: boolean };
}

/**
 * The public module that registers widgets, which the artifact of a widget imports
 */
export const WIDGETS = '@beyond-js/widgets/render';

/**
 * Reads the widget declaration of a module manifest and produces the registration its artifact emits.
 *
 * The compiler generates the registration so that importing the module is enough to make its element
 * known to the page: the metadata names the element, the versioned module the runtime loads its controller
 * from, the attributes the element observes and the render modes it supports.
 */
export class Widget {
	#specs: IWidgetSpecs;
	get specs(): IWidgetSpecs | undefined {
		return this.#specs;
	}

	#errors: IDiagnostic[] = [];
	get errors() {
		return this.#errors;
	}

	/**
	 * @param declared The `widget` value of the module manifest
	 * @param vspecifier The versioned identity of the module
	 */
	constructor(declared: unknown, vspecifier: string, global = false) {
		if (declared === void 0) return;

		const fail = (message: string) => void this.#errors.push({ code: 'WIDGET_INVALID', message });
		if (!declared || typeof declared !== 'object') return fail('The "widget" declaration of the module manifest must be an object');

		const { element, is, route, layout, render } = <IWidgetDeclaration>declared;
		const name = element?.name;
		if (typeof name !== 'string' || !/^[a-z][a-z0-9]*(-[a-z0-9]+)+$/.test(name)) {
			return fail('The "widget.element.name" of the module manifest must be a custom element name (lowercase, with a hyphen)');
		}

		const attrs = element.attrs;
		if (attrs !== void 0 && !(attrs instanceof Array && attrs.every(attr => typeof attr === 'string' && attr))) {
			return fail('The "widget.element.attrs" of the module manifest must be a list of attribute names');
		}
		if (is !== void 0 && !['page', 'layout'].includes(is)) return fail('The "widget.is" of the module manifest must be "page" or "layout"');

		const modes = { csr: render?.csr !== false, ssr: render?.ssr === true, sr: render?.sr === true };
		const multilanguage = render?.multilanguage === true ? { multilanguage: true } : {};
		this.#specs = {
			name,
			vspecifier,
			...(attrs ? { attrs } : {}),
			...(is ? { is } : {}),
			...(typeof route === 'string' ? { route } : {}),
			...(typeof layout === 'string' ? { layout } : {}),
			...(global ? { global: true } : {}),
			render: { ...modes, ...multilanguage }
		};
	}

	/**
	 * The statement that registers the widget, given the namespace of the Widgets render module
	 */
	registration(namespace: string): string {
		return `${namespace}.widgets.register([${JSON.stringify(this.#specs)}]);`;
	}
}
