import { bump } from './state/index.js';
import { store } from './state/store.js';
export const use = () => bump();
export const seen = () => store.value;
