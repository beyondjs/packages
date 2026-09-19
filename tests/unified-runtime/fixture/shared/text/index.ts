/**
 * The entry point of `@fixture/shared/text`: `format` and `store` are re-exported from internal modules,
 * `greet` reads `./format` on each call, and `captured` is computed once, when this file is evaluated.
 */
import { format } from './format';
import { evaluated } from './count';

evaluated('shared/index');

export { format } from './format';
export { store } from './store';

export function greet(subject: string): string {
	return format('Hello', subject);
}

export const captured = format('Hello', 'once');
