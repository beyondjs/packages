// Imports a package the application depends on and this package does not declare: what this package imports is
// decided by its own edges, so `extra` is not installed for it
import { extra } from 'extra';

export const loose = extra;
