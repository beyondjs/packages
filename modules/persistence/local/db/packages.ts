import { Collection } from './collection';
import type { IPackageData } from '@beyond-js/packages/persistence/types';

export /*bundle*/ const packages: Collection<IPackageData> = new Collection('Packages', true);
export /*bundle*/ const dependencies: Collection<IPackageData> = new Collection('Dependencies');
