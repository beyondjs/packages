/**
 * The entry point of `@types-fixture/app/main`: its public declaration keeps the bare references to the installed
 * packages and to the other module of its package that its public types use, which type browsing lists so a client
 * can follow them.
 */
import type { Options } from 'typed-lib';
import { describe } from 'conditioned';
import { greet } from '@types-fixture/app/text';

export { greet };
export type Describe = typeof describe;
export const render = (options: Options): string => greet(describe(options.name));
