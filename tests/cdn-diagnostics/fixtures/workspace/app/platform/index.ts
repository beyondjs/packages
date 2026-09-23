import { join } from 'path';
import { readFileSync } from 'node:fs';

export const home = join(process.env.HOME ?? '', 'data');
export const bytes = Buffer.from(readFileSync(home));
export const cwd = process.cwd();
