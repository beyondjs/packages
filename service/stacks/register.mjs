/**
 * Installs `Stacks` in this process: `node --enable-source-maps --import <this file> …`, as the development service
 * launches a target. See `index.mjs`.
 */
import { Stacks } from './index.mjs';

new Stacks().install();
