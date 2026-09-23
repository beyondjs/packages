import { use, seen } from '@fixture/shared-state';
import { store, bump } from '@fixture/shared-state/state';
import { run, marks } from '@fixture/defaulted';
import view, { count } from '@fixture/defaulted/view';
import { a } from '@fixture/independent';
import { b } from '@fixture/independent/b';
import { value as root } from '@fixture/collision';
import { value as inner } from '@fixture/collision/state';
import { use as required, value as own } from '@fixture/commonjs';
import { store as apart } from '@fixture/commonjs/state';
import { bumped, privately, shared } from '@fixture/opaque';
import { held } from '@fixture/opaque/state';

/**
 * What the delivered application observes: the state each package holds, written through one of its public
 * subpaths and read through the other
 */
export const report = () => {
	use();
	bump();
	run(1);
	view(2);
	required();
	bumped();
	return {
		shared: [seen(), store.value],
		defaulted: [marks(), count()],
		independent: [a(), b()],
		collision: [root(), inner()],
		commonjs: [own(), apart.value],
		opaque: [privately(), shared(), held.value]
	};
};
