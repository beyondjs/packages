/**
 * The entry point of the application: importing each widget module registers its element, and the page
 * composes the elements as HTML.
 */
import '@fixture/cards/react';
import '@fixture/cards/vue';
import '@fixture/cards/svelte';
import '@fixture/cards/html';
import '@fixture/cards/global';

const create = (name: string, label: string) => {
	const element = document.createElement(name);
	element.setAttribute('label', label);
	return element;
};

document.body.append(
	create('card-react', 'React'),
	create('card-vue', 'Vue'),
	create('card-svelte', 'Svelte'),
	create('card-html', 'HTML')
);
