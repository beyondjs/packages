import { WidgetClientController } from '@beyond-js/widgets/controller';

/**
 * A widget written without a view framework: it links inside its root the stylesheets Widgets gives it, removes
 * the ones Widgets no longer lists, and writes one paragraph into its holder
 */
export class Controller extends WidgetClientController {
	get #holder(): HTMLElement {
		return (<any>this.widget).holder;
	}

	#stylesheets = () => {
		const root = this.#holder.parentNode as ShadowRoot;
		const resources = this.styles.resources;
		root.querySelectorAll('link[rel="stylesheet"]').forEach((link: HTMLLinkElement) => !resources.has(link.getAttribute('href')) && link.remove());
		for (const href of resources) {
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
		this.#stylesheets();
		this.styles.on('change', this.#stylesheets);
		this.#holder.innerHTML = '<p>first</p>';
		this.#holder.style.display = '';
	}

	unmount() {
		this.styles.off('change', this.#stylesheets);
		this.#holder.innerHTML = '';
	}
}
