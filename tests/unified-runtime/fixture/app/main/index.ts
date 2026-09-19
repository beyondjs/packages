/**
 * The entry point of `@fixture/app/main`, which reaches the other package only through its public module
 */
import { greet, format, store } from '@fixture/shared/text';
import { label } from './label';

export const main = (): string => `${label} ${greet('World')}`;

// The public re-export of the other module, read through the public boundary on each call
export const direct = (): string => `${label} ${format('Hi', 'there')}`;

export const add = (): number => store.add();
