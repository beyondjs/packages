import { suffix } from '@fixture/words/source';

/**
 * The text a widget writes: its name and the suffix of the other module of this package
 */
export const phrase = (name: string): string => `${name}${suffix}`;
