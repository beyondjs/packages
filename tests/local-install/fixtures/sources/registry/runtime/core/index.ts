// Another public module of the package: it references the bundle instead of carrying a copy of it
import { runtime } from '@sources/runtime/bundle';

export const core: string = `core of ${runtime}`;
