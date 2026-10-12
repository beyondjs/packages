/**
 * A module the page imports only when asked: it is loaded on demand, from the export as from the development service
 */
export const lazy = (): string => 'lazy module loaded';
