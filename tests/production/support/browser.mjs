import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * A headless Chromium driven through `playwright-core`, which this repository does not declare: it is resolved from
 * `BEYOND_PLAYWRIGHT` (a directory where it is installed) or from the suite's Packages interface checkout beside this
 * repository (`packages/ui`), and launches the Chromium installed for that `playwright-core` (`npx playwright-core
 * install chromium`), or the channel `BEYOND_BROWSER_CHANNEL` names (`chrome`). Its absence fails the validation.
 *
 * A page records every request it makes, every answer that failed and every error it reports, which is how a case
 * proves where a page's modules came from and that nothing reached a development service.
 */
export class Browser {
	#browser;

	static #directory() {
		const sibling = fileURLToPath(new URL('../../../../ui', import.meta.url));
		const given = process.env.BEYOND_PLAYWRIGHT ? resolve(process.env.BEYOND_PLAYWRIGHT) : sibling;
		if (!existsSync(join(given, 'node_modules', 'playwright-core')) && !existsSync(join(given, 'package.json'))) {
			throw new Error('playwright-core was not found: set BEYOND_PLAYWRIGHT to a directory where it is installed');
		}
		return given;
	}

	async start() {
		const { chromium } = createRequire(pathToFileURL(join(Browser.#directory(), 'package.json')).href)('playwright-core');
		const channel = process.env.BEYOND_BROWSER_CHANNEL;
		this.#browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) });
		return this;
	}

	get version() {
		return this.#browser.version();
	}

	/**
	 * A new page and what it observes: `requests` (every URL it asked for), `failed` (answers of 400 or more and
	 * requests that failed) and `errors` (uncaught errors and console errors)
	 */
	async page() {
		const page = await this.#browser.newPage();
		const observed = { requests: [], failed: [], errors: [] };
		page.on('request', request => observed.requests.push(request.url()));
		page.on('requestfailed', request => observed.failed.push(`${request.failure()?.errorText} ${request.url()}`));
		page.on('response', response => response.status() >= 400 && observed.failed.push(`${response.status()} ${response.url()}`));
		page.on('pageerror', error => observed.errors.push(error.message));
		page.on('console', message => message.type() === 'error' && observed.errors.push(message.text()));
		return { page, observed };
	}

	/**
	 * What the page of the web fixture rendered, once it did: its greeting, its route, the external package's answer,
	 * the badge's image, the heading's color and the badge's width, read from the page itself
	 *
	 * @param {import('playwright-core').Page} page
	 */
	static async rendered(page) {
		await page.waitForFunction(() => document.body.dataset.greeting && document.body.dataset.badge === 'loaded', null, { timeout: 30000 });
		return page.evaluate(() => ({
			greeting: document.body.dataset.greeting,
			route: document.body.dataset.route,
			tiny: document.body.dataset.tiny,
			color: getComputedStyle(document.querySelector('.greeting')).color,
			width: getComputedStyle(document.querySelector('.badge')).width,
			badge: document.querySelector('.badge').naturalWidth
		}));
	}

	/**
	 * Presses the button that imports the lazy module, and what it rendered
	 *
	 * @param {import('playwright-core').Page} page
	 */
	static async lazy(page) {
		await page.click('#lazy');
		await page.waitForFunction(() => document.body.dataset.lazy, null, { timeout: 30000 });
		return page.evaluate(() => document.body.dataset.lazy);
	}

	stop() {
		return this.#browser?.close();
	}
}
