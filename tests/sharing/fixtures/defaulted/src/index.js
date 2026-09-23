import view from './view/index.js';
import { seen } from './view/state.js';
export const run = mark => view(mark);
export const marks = () => seen.length;
