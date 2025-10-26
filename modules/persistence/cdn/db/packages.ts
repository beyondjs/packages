import { Collection } from './collection';
import type { IPackageInstallData, IPackageReleaseData } from '@beyond-js/packages/persistence/types';

export /*bundle*/ const packages: Collection<IPackageReleaseData> = new Collection('Packages');
export /*bundle*/ const installed: Collection<IPackageInstallData> = new Collection('InstalledPackages');
