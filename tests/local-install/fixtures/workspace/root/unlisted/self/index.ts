import { base } from '@fixture/unlisted/base';

// A module of its own package needs no edge of the installed graph
export const self: string = `${base} self`;
