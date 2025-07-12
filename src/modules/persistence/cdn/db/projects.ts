import { Collection } from '@beyond-js/firestore-collection/collection';
import type { IProjectData } from '@beyond-js/packages/persistence/interfaces';

export /*bundle*/ const projects: Collection<IProjectData> = new Collection('Projects');
