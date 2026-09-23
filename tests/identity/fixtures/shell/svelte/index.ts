import { SvelteWidgetController } from '@beyond-js/svelte-widgets/base';
import View from './view.svelte';

export class Controller extends SvelteWidgetController {
	get Widget() {
		return View;
	}
}
