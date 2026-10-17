import { sum } from './math';

// Top-level code of the entry: it must run once, in the artifact of `./main` only
(<{ evaluations?: string[] }>globalThis).evaluations?.push('main');

export const total = sum(2, 3);
