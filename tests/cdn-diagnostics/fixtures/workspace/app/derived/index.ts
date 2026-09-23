import { greetings } from '@fixture/shared/message';

export function untyped(value) {
	return value;
}
export const texts = greetings.map(one => one.text);
