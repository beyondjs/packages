import { message } from '@serving/message/main';
import { version } from 'react';
import { shared } from 'shared';

export const main = `app-a: ${message}, ${shared}, react ${version}`;
