/**
 * The entry point of `@fixture/web/main`. Importing it defines the element and adds one to the page: the
 * preview document imports the entry module and calls nothing.
 */
import { greet } from '@fixture/shared/text';
import { store } from './store';
import { sheet } from './styles';
import { label } from './view';

class Counter extends HTMLElement {
	#output: HTMLElement;

	connectedCallback() {
		const root = this.attachShadow({ mode: 'open' });
		root.adoptedStyleSheets = [sheet];

		this.#output = root.appendChild(document.createElement('p'));
		const button = root.appendChild(document.createElement('button'));
		button.textContent = 'Add';
		button.addEventListener('click', () => {
			store.add();
			this.draw();
		});
		this.draw();
	}

	draw() {
		this.#output.textContent = `${greet('preview')} | ${label(store.count)}`;
	}
}

customElements.define('fixture-counter', Counter);
document.body.appendChild(document.createElement('fixture-counter'));
