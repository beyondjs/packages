import { message } from '@fixture/message/main';
import { words } from 'message-two/main';

// The first version by its name and the second through an alias, in one module: only the second has words
export const first: string = message;
export const second: string[] = words;
