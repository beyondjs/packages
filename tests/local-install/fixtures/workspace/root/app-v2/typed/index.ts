import type { Greeting } from 'greeting';
import { wrap } from 'kit';

// The second version of `greeting` types a greeting with words; `kit` receives it in the context of this package
export const greeting: Greeting = { words: ['hello', 'world'] };
export const wrapped: string = wrap(greeting);
