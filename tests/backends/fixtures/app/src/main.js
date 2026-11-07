import { inspect, reads, joined, emitter } from '@fixture/builtins';
import { codes } from '@fixture/optional';
import { hostname } from 'os';

/** What the delivered backend observes */
export const report = () => ({ inspected: inspect({ a: 1 }), reads, joined, emitter, codes, host: typeof hostname() });
