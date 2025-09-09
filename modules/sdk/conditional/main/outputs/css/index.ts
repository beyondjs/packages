import type { IOutput } from '@beyond-js/packages/module';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';

export class CSSOutput extends DynamicProcessor() implements IOutput {
	get dp() {
		return 'bundler.output.css';
	}

	get code() {
		return '';
	}
}
