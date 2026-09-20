/**
 * What the element shows. The validation edits this file while the page runs.
 */
export const label = (count: number): string => `Count: ${count}`;

// This file is evaluated again when its update is applied: the elements already on the page draw with it
document.querySelectorAll<HTMLElement & { draw?: () => void }>('fixture-counter').forEach(element => element.draw?.());
