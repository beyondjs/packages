import type { IConditions } from '@beyond-js/packages/types';
import { BaseModule } from '@beyond-js/packages/module';

export /*bundle*/ class Module extends BaseModule {
	_conditionals(): IConditions[] {
		console.log(this.spec.values);
		return [];
	}

	_conditional({ key }: { key: string }): Conditional {
		return;
	}
}
