/**
 * The identifiers that join the code of a component to its stylesheet, read from generated outputs: the
 * `data-v-…` attribute of a Vue component with scoped styles and the `svelte-…` class of a Svelte one.
 */
const PATTERNS = [/data-v-[0-9a-f]{8}/g, /svelte-[0-9a-z]{6,}/g];

// Classes Svelte writes that do not scope a component
const IGNORED = new Set(['svelte-widgets', 'svelte-trusted']);

export class Scopes {
	/**
	 * The scope identifiers a text holds
	 */
	static of(text) {
		const found = new Set();
		for (const pattern of PATTERNS) for (const [match] of String(text ?? '').matchAll(pattern)) IGNORED.has(match) || found.add(match);
		return found;
	}

	/**
	 * The scope identifiers of the code and of the stylesheet of one unit
	 */
	static unit(unit) {
		const text = kind => unit?.outputs?.filter(output => output.kind === kind).map(output => output.code).join('\n');
		return { js: Scopes.of(text('js')), css: Scopes.of(text('css')) };
	}

	/**
	 * The one scope identifier of a module that holds one component
	 */
	static single(unit, label) {
		const { js, css } = Scopes.unit(unit);
		if (js.size !== 1 || css.size !== 1) throw new Error(`${label} must hold one scoped component: code ${[...js]}, stylesheet ${[...css]}`);
		return [...js][0];
	}
}
