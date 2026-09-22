import { ReactWidgetController } from '@beyond-js/react-19-widgets/base';
import { View } from './view';

export class Controller extends ReactWidgetController {
	get Widget() {
		return View;
	}
}
