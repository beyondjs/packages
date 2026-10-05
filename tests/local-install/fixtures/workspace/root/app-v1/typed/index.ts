import type { Greeting } from 'greeting';
import { wrap } from 'kit';
import { plain } from 'plain';

// The first version of `greeting` types a greeting with a text; `kit` receives it in the context of this package
export const greeting: Greeting = { text: plain };
export const wrapped: string = wrap(greeting);

// `@types/plain` types `plain` as a string, which is not a number: without those types the directive is unused
// @ts-expect-error
export const count: number = plain;
