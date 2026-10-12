/**
 * The entry point of `@applications/shared/message`, for Node consumers and browsers.
 */
export const message = (who: string): string => `Hello ${who}, from the shared module`;
