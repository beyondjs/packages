/**
 * What a widget of the identity application shows: the colour of each title inside its shadow root, by
 * whose component rendered it
 */
export const colours = (page, element) =>
	page.evaluate(element => {
		const root = window.document.querySelector(element)?.shadowRoot;
		const colour = name => {
			const found = root?.querySelector(`.title.${name}`);
			return found ? window.getComputedStyle(found).color : 'absent';
		};
		return { shell: colour('shell'), kit: colour('kit'), panel: colour('panel') };
	}, element);
