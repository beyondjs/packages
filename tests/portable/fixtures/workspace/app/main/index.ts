/**
 * The entry point of `@portable/app/main`, which the preview of the validation opens: importing it writes the
 * greeting on the page, where the browser probe reads it.
 */
import { greet } from '@portable/app/text';

document.body.dataset.greeting = greet('preview');
