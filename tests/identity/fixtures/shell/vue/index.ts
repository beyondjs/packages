import { VueWidgetController } from '@beyond-js/vue-widgets/base';
import View from './view.vue';

export class Controller extends VueWidgetController {
	get Widget() {
		return View;
	}
}
