// Written against the Kernel's identities, as Widgets is: the bundler imports the core of the runtime it names
// (`@sources/runtime/core`), which is the runtime of the page and not a dependency of this package
import { core } from '@beyond-js/kernel/core';
import { tone } from 'tone';

export const greeting = (name: string): string => `Hello ${name}, in ${tone} (${core})`;
