/**
 * The runtime a composed module is written against. It is TypeScript, so it is delivered only when its sources are
 * compiled: the installed file itself is no module a browser can load.
 */
const release: string = '1.0.0';

export const runtime = `sources runtime ${release}, compiled from TypeScript`;
