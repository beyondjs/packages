// Top-level code of the entry of `./math`, which `./main` also imports as an internal module
(<{ evaluations?: string[] }>globalThis).evaluations?.push('math');

export const sum = (a: number, b: number): number => a + b;
