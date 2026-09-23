import { WidgetClientController } from '@beyond-js/widgets/controller';

/**
 * A widget of a package without a shared stylesheet: it adopts its own sheet and nothing else
 */
export class Controller extends WidgetClientController {
	mount() {
		(<any>this.widget).holder.innerHTML = '<span class="badge">bare</span>';
	}

	unmount() {
		(<any>this.widget).holder.innerHTML = '';
	}
}
