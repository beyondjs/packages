import { evaluated } from './count';

evaluated('shared/store');

/**
 * State that lives in an internal module. An update of another file of the module must not reset it.
 */
export const store = {
	count: 0,
	add(): number {
		return ++this.count;
	}
};
