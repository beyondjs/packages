/**
 * What a page of the browser probe does in each engine, sent to the page with `page.evaluate`: every function runs in
 * the browser, receives plain values and answers plain values, and bounds each wait so that a request a browser holds
 * is reported rather than awaited forever.
 */
export class Probe {
	/**
	 * Pairs with a code, reads the session with the token, and holds the event stream until it says `subscribed`
	 *
	 * @param {{api: string, code: string, timeout: number}} options
	 */
	static async pair({ api, code, timeout }) {
		const bounded = (promise, what) => Promise.race([promise, new Promise((resolve, reject) => setTimeout(() => reject(new Error(`${what}: no answer within ${timeout} ms`)), timeout))]);
		const steps = {};
		try {
			const paired = await bounded(fetch(`${api}/pairing`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) }), 'POST /pairing');
			const body = await paired.json();
			steps.pairing = { status: paired.status, origin: body.pairing?.origin };
			if (!body.token) return steps;
			const authorization = `Bearer ${body.token}`;

			const session = await bounded(fetch(`${api}/session`, { headers: { authorization } }), 'GET /session');
			const described = await session.json();
			steps.session = { status: session.status, capabilities: Object.keys(described.capabilities ?? {}).length, preview: described.service?.preview };

			const unpaired = await bounded(fetch(`${api}/session`), 'GET /session without a token');
			steps.unpaired = { status: unpaired.status, code: (await unpaired.json()).error?.code };

			const events = await bounded(fetch(`${api}/events`, { headers: { authorization } }), 'GET /events');
			const reader = events.body.getReader();
			const decoder = new TextDecoder();
			let text = '';
			while (!text.includes('event: subscribed')) {
				const { value, done } = await bounded(reader.read(), 'the event stream');
				if (done) break;
				text += decoder.decode(value);
			}
			await reader.cancel();
			steps.events = { status: events.status, subscribed: text.includes('event: subscribed') };

			const left = await bounded(fetch(`${api}/pairing`, { method: 'DELETE', headers: { authorization } }), 'DELETE /pairing');
			steps.left = { status: left.status };
		} catch (error) {
			steps.error = String(error?.message ?? error);
		}
		return steps;
	}

	/**
	 * What a page of a site that is not allowed obtains: each read is `read` with its status, or `blocked` with the
	 * browser's error; a text body is sent without asking (`no-cors`), and the caller checks the disk
	 *
	 * @param {{api: string, timeout: number}} options
	 */
	static async foreign({ api, timeout }) {
		const bounded = promise => Promise.race([promise, new Promise((resolve, reject) => setTimeout(() => reject(new Error(`no answer within ${timeout} ms`)), timeout))]);
		const read = async path => {
			try {
				const response = await bounded(fetch(`${api}${path}`));
				return { read: response.status, body: (await response.text()).slice(0, 80) };
			} catch (error) {
				return { blocked: String(error?.message ?? error) };
			}
		};
		const steps = { session: await read('/session'), secret: await read('/files/content/app/.env') };
		try {
			const batch = JSON.stringify({ mutations: [{ operation: 'write', path: 'app/injected.ts', expected: 'absent', content: 'x' }] });
			await bounded(fetch(`${api}/files/operations`, { method: 'POST', mode: 'no-cors', headers: { 'content-type': 'text/plain' }, body: batch }));
			steps.post = 'sent';
		} catch (error) {
			steps.post = `blocked: ${String(error?.message ?? error)}`;
		}
		return steps;
	}

	/**
	 * Whether a classic script loads: `loaded`, or `refused` when the browser could not load it (the service refused
	 * it, or the browser blocked it); a page of another site that loads a module as `format=system` this way runs it
	 * with a shim of its own
	 *
	 * @param {{src: string, timeout: number}} options
	 */
	static script({ src, timeout }) {
		return new Promise(resolve => {
			const script = document.createElement('script');
			const timer = setTimeout(() => resolve({ script: `no outcome within ${timeout} ms` }), timeout);
			script.onload = () => (clearTimeout(timer), resolve({ script: 'loaded' }));
			script.onerror = () => (clearTimeout(timer), resolve({ script: 'refused' }));
			script.src = src;
			document.head.append(script);
		});
	}

	/**
	 * What code that runs in a preview obtains: the application's greeting, a source of its own origin, and pairing
	 * with a valid code at the API origin
	 *
	 * @param {{api: string, code: string, timeout: number}} options
	 */
	static async preview({ api, code, timeout }) {
		const bounded = promise => Promise.race([promise, new Promise((resolve, reject) => setTimeout(() => reject(new Error(`no answer within ${timeout} ms`)), timeout))]);
		const steps = { greeting: document.body.dataset.greeting };
		const own = await bounded(fetch('/files/content/app/.env'));
		steps.source = { status: own.status };
		try {
			const paired = await bounded(fetch(`${api}/pairing`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) }));
			steps.pairing = { read: paired.status };
		} catch (error) {
			steps.pairing = { blocked: String(error?.message ?? error) };
		}
		return steps;
	}
}
