/**
 * The entry point of the application: importing each widget module registers its element, and the page
 * composes the elements as HTML.
 */
import '@fixture/shell/vue';
import '@fixture/shell/svelte';

document.body.append(document.createElement('shell-vue'), document.createElement('shell-svelte'));
