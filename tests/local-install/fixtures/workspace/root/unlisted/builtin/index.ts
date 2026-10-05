import { sep } from 'node:path';

// A builtin needs no edge; its types are those of @types/node, which this package does not have
export const separator: string = sep;
