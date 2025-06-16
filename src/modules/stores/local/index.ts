import { db } from './db';
import { PackagesStore } from './packages';

export const store = new PackagesStore(db);
