import { Collection } from './collection';
import type { IPackageData, IPackageReleaseData } from '@beyond-js/packages/persistence/types';

export /*bundle*/ const packages: Collection<IPackageData> = new Collection('Packages', true);
export /*bundle*/ const releases: Collection<IPackageReleaseData> = new Collection('PackageReleases', true);
