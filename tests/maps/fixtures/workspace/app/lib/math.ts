import { format } from './format';
export function fail(value: number): never {
	throw new Error(`math failed with ${format(value)}`);
}
