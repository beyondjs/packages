// data/collections/accounts.ts
import { Collection } from '@beyond-js/firestore-collection/collection';
import type { IPackageData } from '@beyond-js/cdn';

export /*bundle*/ const packages: Collection<IPackageData> = new Collection('Packages');
