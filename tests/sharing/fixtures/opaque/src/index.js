import { held } from './state/index.js';
import { held as copied } from './state/store.js';
export const bumped = () => ++copied.value;
export const privately = () => copied.value;
export const shared = () => held.value;
