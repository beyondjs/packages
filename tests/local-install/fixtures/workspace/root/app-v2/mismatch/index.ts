import { wrap } from 'kit';

// In the context of this package, `kit` receives the second version of a greeting, which has no text
export const wrapped: string = wrap({ text: 'hello' });
