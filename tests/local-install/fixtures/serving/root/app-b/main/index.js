import { message } from '@serving/message/main';
import { kit } from 'kit';
import { ping } from 'ping';
import { version } from 'react';
import { shared } from 'shared';
import { toolkit } from 'toolkit';

export const main = `app-b: ${message}, ${shared}, ${kit}, ${ping()}, react ${version}, ${toolkit}`;
