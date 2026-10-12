/**
 * The entry point of the frontend target: importing it writes the greeting on the page.
 */
import { message } from '@applications/shared/message';
import { label } from '@applications/web/widget';

document.body.dataset.greeting = `${label}: ${message('browser')}`;
