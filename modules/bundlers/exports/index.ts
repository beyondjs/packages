import type { IConditions } from '@beyond-js/packages/types';
import { BaseModule } from '@beyond-js/packages/module';
import { Conditional } from './conditional';

export /*bundle*/ class Module extends BaseModule {
	_conditionals(): IConditions[] {
		console.log(this.spec.values);
		return [{ platform: 'node' }];
	}

	_conditional({ key }: { key: string }): Conditional {
		console.log(`Creating conditional for key "${key}"`);
		return;
	}
}
