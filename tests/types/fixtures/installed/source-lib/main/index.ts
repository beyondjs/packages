/**
 * A package published in source form: the type check reads this TypeScript source.
 */
import type { Options } from 'typed-lib';

export const label = (options: Options): string => options.name;
