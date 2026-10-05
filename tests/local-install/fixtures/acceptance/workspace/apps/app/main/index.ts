/**
 * The entry point of `@lt/app/main`: each bare reference is resolved through this package's own edges, so
 * `@lt/message/text` is version 1 here while `@lt/banner/banner` reaches version 2 through its own edges.
 */
import { text } from '@lt/message/text';
import { banner } from '@lt/banner/banner';
import { view } from '@lt/counter-view/view';

export const page = `${text} | ${banner} | ${view()}`;
