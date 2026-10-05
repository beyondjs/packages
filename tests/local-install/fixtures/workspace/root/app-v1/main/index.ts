import { message } from '@fixture/message/main';
import { greet } from 'greeting';
import { wrap } from 'kit';
import { plain } from 'plain';

export const text = `${greet(message)} ${wrap({ text: plain })}`;
