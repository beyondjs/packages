import { Output } from '@beyond-js/bundlers-sdk/conditional/output';

export class CSSOutput extends Output {
	get dp() {
		return 'bundler.output.css';
	}
}
