/**
 * The entry point of `@fixture/shared/text`. The stand-in CDN of the validation serves another
 * implementation of this module, which answers `[cdn]`, so a page shows where the module came from.
 */
export const greet = (subject: string): string => `[environment] Hello ${subject}`;
