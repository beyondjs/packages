import { value as inner } from './state/index.js';
import { value as copied } from './state/store.js';
export const value = () => `root:${inner()}:${copied()}`;
