/**
 * The shared stylesheet of a package in a running page: every widget of the package that publishes `./global`
 * adopts it inside its own root, and a development update of that sheet reaches every one of them and no widget
 * of another package. The page is the preview document of the real development service with the Widgets
 * sources and the development runtime as packages of the workspace; the runtime of the page applies the update.
 */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { Browser, Fork, Host, Runtime, Widgets, Workspace, results, step } from './harness.mjs';
import { Viewer } from './viewer.mjs';

const { BEE_URL, WATCHERS_URL } = process.env;
if (!BEE_URL || !WATCHERS_URL) throw new Error('Set BEE_URL and WATCHERS_URL to the Engine servers of Packages and of the watchers utility.');

const GLOBAL = '@fixture/ui@0.1.0/global';
const ENTRY = '@fixture/page/main';
const fork = new Fork();
const cleanup = [];
const workspace = await new Workspace().create(new Runtime(), { fixture: 'widgets-fixture', widgets: new Widgets() });
cleanup.push(() => workspace.destroy());

let host, browser, viewer;

const sheet = workspace.file('ui/global.scss');

/**
 * What each widget shows inside its root: its text, the color of its paragraph and the stylesheets it links
 */
const probe = () =>
	viewer.page.evaluate(() => {
		const read = name => {
			const root = document.querySelector(name)?.shadowRoot;
			const paragraph = root?.querySelector('p');
			const links = [...(root?.querySelectorAll('link[rel="stylesheet"]') ?? [])].map(link => link.getAttribute('href'));
			return { text: paragraph?.textContent, color: paragraph && getComputedStyle(paragraph).color, links };
		};
		return { first: read('ui-first'), second: read('ui-second'), third: read('other-third') };
	});

/**
 * Waits until both widgets of `@fixture/ui` paint their paragraph with a color
 */
const painted = color => {
	const done = color => ['ui-first', 'ui-second'].every(name => {
		const paragraph = document.querySelector(name)?.shadowRoot?.querySelector('p');
		return paragraph && getComputedStyle(paragraph).color === color;
	});
	return viewer.page.waitForFunction(done, color, { timeout: 60000 });
};
const global = links => links.filter(href => href.includes('/@fixture/ui@0.1.0/styles/global'));

try {
	await step('service: the preview reaches three widgets of two packages, and the runtime is its coordinator', async () => {
		host = await new Host().start(workspace.root, { implementation: BEE_URL, watchers: WATCHERS_URL, BEYOND_ESBUILD_COMPILER: fork.file });
		cleanup.push(() => host.stop());

		const { modules, updates, diagnostics } = await (await fetch(`${host.origin}/preview/entry.json?entry=${ENTRY}`)).json();
		const widgets = modules.filter(({ widget }) => widget).map(({ specifier }) => specifier).sort();
		assert.deepEqual(widgets, ['@fixture/other/third', '@fixture/ui/first', '@fixture/ui/second'], JSON.stringify(diagnostics));
		assert.equal(updates.runtime, '@beyond-js/local-2026/main');
		// The shared sheet is not imported by any module, so the session the page is given may not describe it:
		// the runtime then addresses its updates from the address the widgets registered
		const described = !!updates.session.modules['@fixture/ui/global'];
		return `${host.origin}, ${modules.length} modules; the session ${described ? 'describes' : 'does not describe'} ${GLOBAL}`;
	});

	await step('browser: each widget of @fixture/ui adopts the shared sheet in its root, and the widget of @fixture/other adopts none', async () => {
		browser = await new Browser().start();
		cleanup.push(() => browser.stop());
		viewer = await new Viewer('browser/widgets', await browser.page()).open(`${host.origin}/preview/?entry=${ENTRY}`, 'other-third');
		await painted('rgb(10, 20, 30)');

		const { first, second, third } = await probe();
		assert.deepEqual([first.text, second.text, third.text], ['first', 'second', 'third']);
		assert.deepEqual([global(first.links).length, global(second.links).length], [1, 1], JSON.stringify({ first, second }));
		assert.deepEqual([third.color, global(third.links)], ['rgb(0, 0, 0)', []], JSON.stringify(third));
		assert.deepEqual(await viewer.page.evaluate(() => [...document.querySelectorAll('link[data-beyond-styles]')].length), 0, 'The document links nothing only widgets adopt');
	});

	let valid, before;
	await step('update: an edit of the shared sheet reaches every widget of its package and no other', async () => {
		valid = await readFile(sheet, 'utf8');
		before = await probe();
		await writeFile(sheet, valid.replace('rgb(10, 20, 30)', 'rgb(40, 50, 60)'));
		await viewer.until('styles', GLOBAL);
		await painted('rgb(40, 50, 60)');

		const after = await probe();
		for (const widget of [after.first, after.second]) {
			const [link] = global(widget.links);
			assert.ok(global(widget.links).length === 1 && /\/u\/[0-9a-f]{32}\/@fixture\/ui@0\.1\.0\/styles\/global\?/.test(link), JSON.stringify(widget.links));
		}
		assert.deepEqual(after.third, before.third, 'The widget of another package is untouched');
		before = after;
	});

	await step('invalid: a broken shared sheet is reported, and every widget keeps the last valid one', async () => {
		await writeFile(sheet, valid.replace('$ink;', '$missing;'));
		await viewer.until('invalid', GLOBAL);
		assert.deepEqual(await probe(), before, 'Colors and links are the last valid ones');
	});

	await step('correction: the corrected shared sheet is applied to every widget of its package', async () => {
		await writeFile(sheet, valid.replace('rgb(10, 20, 30)', 'rgb(70, 80, 90)'));
		await painted('rgb(70, 80, 90)');
		const after = await probe();
		assert.deepEqual([global(after.first.links).length, global(after.second.links).length], [1, 1]);
		assert.notDeepEqual(global(after.first.links), global(before.first.links));
		assert.deepEqual(after.third, before.third, 'The widget of another package is untouched');

		const errors = (await viewer.events()).filter(([type]) => type === 'error');
		assert.deepEqual(errors, []);
		assert.deepEqual(viewer.observed.errors.filter(message => !/Failed to load resource/.test(message)), []);
		assert.equal(await viewer.close(), false);
	});
} finally {
	const failed = results.some(result => !result.ok);
	failed && host && console.log(`--- service log ---\n${host.log.slice(-3000)}`);
	failed && viewer && console.log(`--- page ---\n${JSON.stringify({ observed: viewer.observed, events: await viewer.events().catch(() => []), probe: await probe().catch(() => null) }, null, 1)}`);
	for (const task of cleanup.reverse()) await Promise.resolve().then(task).catch(error => console.log(`cleanup: ${error.message}`));
}

const failed = results.filter(result => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} steps passed`);
process.exit(failed.length ? 1 : 0);
