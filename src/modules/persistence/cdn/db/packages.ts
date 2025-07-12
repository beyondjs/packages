import { Collection } from './collection';
import type { IPackageData } from '@beyond-js/packages/persistence/interfaces';

export /*bundle*/ const packages: Collection<IPackageData> = new Collection('Packages');
