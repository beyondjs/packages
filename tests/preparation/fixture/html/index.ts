import { WidgetClientController } from '@beyond-js/widgets/controller';
// A stylesheet of the package selected by the widget: adopted in its root, never linked by the document
import '@fixture/cards/tone.css';

/**
 * A widget written without a view framework: it writes its own markup into the holder of its element
 */
export class Controller extends WidgetClientController {
	#mounted = false;
	get mounted() {
		return this.#mounted;
	}

	get #holder(): HTMLElement {
		return (<any>this.widget).holder;
	}

	#stylesheets = () => {
		const root = this.#holder.parentNode as ShadowRoot;
		for (const href of this.styles.resources.keys()) {
			if (root.querySelector(`link[href="${href}"]`)) continue;
			const link = document.createElement('link');
			link.rel = 'stylesheet';
			link.href = href;
			link.onload = () => this.styles.onloaded(href);
			link.onerror = () => this.styles.onerror(href);
			root.insertBefore(link, this.#holder);
		}
	};

	mount() {
		if (this.#mounted) return;
		this.#mounted = true;

		this.#stylesheets();
		this.styles.on('change', this.#stylesheets);
		this.#holder.innerHTML = `<p class="card html">${this.attributes.get('label') ?? ''}</p>`;
		this.#holder.style.display = '';
	}

	unmount() {
		if (!this.#mounted) return;
		this.#mounted = false;

		this.styles.off('change', this.#stylesheets);
		this.#holder.innerHTML = '';
	}
}
