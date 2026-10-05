import { wrap } from 'kit';

// In the context of this package, `kit` receives the first version of a greeting, which has no words
export const wrapped: string = wrap({ words: ['hello'] });
