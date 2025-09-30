import { Collection } from './collection';
import type { IPackageManifestData } from '@beyond-js/packages/persistence/types';

export /*bundle*/ const manifests: Collection<IPackageManifestData> = new Collection('PackageManifests', true);
