import type { IConditions } from '@beyond-js/packages/types';
import { BaseModule } from '@beyond-js/packages/module';
import { Conditional } from './conditional';

export /*bundle*/ class Module extends BaseModule {
	_conditionals(): IConditions[] {
		return [{ platform: 'node' }];
	}

	_conditional({ key }: { key: string }): Conditional {
		if (key !== 'node') throw new Error(`Conditional ${key} not implemented`);

		return new Conditional(this, { platform: 'node' });
	}
}
