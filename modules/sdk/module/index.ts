import { BaseModule } from '@beyond-js/packages/module';

export /*bundle*/ abstract class Module extends BaseModule {
	_processors() {
		throw new Error(`Private method '_processors' must be overriden`);
	}
}
