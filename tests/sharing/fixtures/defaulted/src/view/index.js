import { seen } from './state.js';
export const count = () => seen.length;
export default mark => (seen.push(mark), seen.length);
