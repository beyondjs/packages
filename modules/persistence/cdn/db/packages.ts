import { Collection } from './collection';
import type { IPackageReleaseData } from '@beyond-js/packages/persistence/types';

export /*bundle*/ const packages: Collection<IPackageReleaseData> = new Collection('Packages');
