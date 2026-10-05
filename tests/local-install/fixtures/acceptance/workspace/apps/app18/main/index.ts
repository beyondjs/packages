/**
 * The entry point of `@lt/app18/main`: `workspace:*` selects the highest member version of `@lt/message` (2.0.0,
 * outside the workspace root), and `@lt/counter-view` sees React 18 in this application's context.
 */
import { text } from '@lt/message/text';
import { view } from '@lt/counter-view/view';

export const page = `${text} | ${view()}`;
