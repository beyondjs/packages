/**
 * The stylesheet of the element, adopted by its shadow root
 */
export const sheet = new CSSStyleSheet();
sheet.replaceSync(`
	:host { display: block; font-family: system-ui, sans-serif; }
	button { background-color: rgb(12, 74, 110); color: rgb(255, 255, 255); border: 0; padding: 8px 12px; }
`);
