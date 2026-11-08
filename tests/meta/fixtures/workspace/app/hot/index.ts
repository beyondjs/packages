import { half } from './half';

// import.meta outside call parentheses, which the analysis of CommonJS refused before (audit F6)
export const url = import.meta.url;
export let count: number = import.meta.hot?.data.count ?? half(4);

if (import.meta.hot) {
	import.meta.hot.dispose(data => (data.count = count));
	import.meta.hot.accept();
}

// A property of the reserved name binds nothing and is allowed
export const keyed = { __beyond_meta: 1 }.__beyond_meta;
export const keys = Object.keys(import.meta);
