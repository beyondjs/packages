import { wrapped } from '@fixture/wrap/main';

// `wrapped` is typed by the declaration of message-v2, reached through the declaration of wrap: a string,
// which is not a number. Were it untyped (`any`), the directive would be unused and the check would fail.
export const value: string = wrapped;
// @ts-expect-error
export const count: number = wrapped;
