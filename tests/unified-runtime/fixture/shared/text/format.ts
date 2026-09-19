import { evaluated } from './count';

evaluated('shared/format');

export const format = (greeting: string, subject: string): string => `${greeting} ${subject}!`;
