import { half } from './half';

// import.meta outside call parentheses, which the analysis of CommonJS refused before (audit F6)
export const url = import.meta.url;
export let count: number = import.meta.hot?.data.count ?? half(4);

if (import.meta.hot) {
	import.meta.hot.dispose(data => (data.count = count));
	import.meta.hot.accept();
}
