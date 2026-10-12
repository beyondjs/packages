/**
 * The entry of the page. Importing it renders the greeting, the route the page was opened at, the answer of an
 * external package and the badge of another package, and loads `@production/web/lazy` only when the button is pressed.
 * What it renders is also written on `document.body.dataset`, which the validation reads.
 */
import { greet } from '@production/shared/text';
import { shout } from 'tiny';
import '@production/art/badge';

const body = document.body;
const title = body.appendChild(document.createElement('h1'));
title.className = 'greeting';
title.textContent = greet('browser');
body.dataset.greeting = title.textContent;
body.dataset.route = location.pathname;
body.dataset.tiny = shout('tiny');

const button = body.appendChild(document.createElement('button'));
button.id = 'lazy';
button.textContent = 'Load more';
button.addEventListener('click', async () => {
	const { lazy } = await import('@production/web/lazy');
	body.dataset.lazy = lazy();
});
