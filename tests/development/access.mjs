/**
 * Delegated access to the routes the hosting service mounts beside the ones of the contract: the installation of
 * the workspace (`GET` and `POST /installation`) and the resolution documents (`/resolution.json`,
 * `/importmap.json`). The guard of the development extension covers them like the session, the state and the
 * compiled modules, over the stand-ins of those routes that `serve` mounts; local mode keeps needing no grant. Express
 * routes a path whatever its case and with an ending slash, so those spellings are guarded as well.
 */
import assert from 'node:assert/strict';
import { step } from './harness.mjs';
import { Signer, serve, vectors } from './service.mjs';

const { Access } = await import('@beyond-js/packages/development');

/**
 * The method and path of a route, the grant that may use it, the grants it refuses, and what the allowed grant gets
 * from the stand-ins: their answer, or `404` where none serves the method or the path
 */
const ROUTES = [
	['GET', '/installation', 'inspector', ['writer', 'visitor'], 200],
	['HEAD', '/installation', 'inspector', ['writer', 'visitor'], 200],
	['POST', '/installation', 'writer', ['inspector', 'visitor'], 200],
	['PUT', '/installation', 'writer', ['inspector', 'visitor'], 404],
	['GET', '/resolution.json?target=browser&format=esm', 'visitor', ['inspector', 'writer'], 200],
	['GET', '/importmap.json', 'visitor', ['inspector', 'writer'], 200]
];

/**
 * Spellings Express routes to the same handlers: another case and an ending slash
 */
const SPELLINGS = [
	['POST', '/Installation', 'writer', ['inspector', 'visitor'], 200],
	['POST', '/INSTALLATION', 'writer', ['inspector', 'visitor'], 200],
	['POST', '/installation/', 'writer', ['inspector', 'visitor'], 200],
	['GET', '/Installation/', 'inspector', ['writer', 'visitor'], 200],
	['GET', '/Resolution.JSON', 'visitor', ['inspector', 'writer'], 200],
	['GET', '/session/', 'inspector', ['writer', 'visitor'], 200],
	['GET', '/State', 'inspector', ['writer', 'visitor'], 404],
	['GET', '/M/@case/app@1.0.0/modules/main', 'visitor', ['inspector', 'writer'], 404]
];

/**
 * The routes of the hosting service's features (developer-journey.md), which `serve` does not mount: the guard decides
 * before any handler, so the allowed grant reaches a route none serves (`404`). Launching, changing the settings and
 * publishing need capabilities no grant carries: every grant is refused (`allowed` undefined)
 */
const OPERATION = 'op_000000000000000000000000';
const FEATURES = [
	['GET', '/operations', 'inspector', ['writer', 'visitor'], 404],
	['GET', `/operations/${OPERATION}`, 'inspector', ['writer', 'visitor'], 404],
	['POST', `/operations/${OPERATION}/cancel`, 'controller', ['inspector', 'writer', 'visitor'], 404],
	['GET', '/launches', 'inspector', ['writer', 'visitor'], 404],
	['POST', '/launches', undefined, ['inspector', 'writer', 'visitor', 'controller'], undefined],
	['POST', '/launches/lch_000000000000000000000000/stop', undefined, ['inspector', 'writer', 'visitor', 'controller'], undefined],
	['GET', '/settings', 'inspector', ['writer', 'visitor'], 404],
	['PUT', '/settings', undefined, ['inspector', 'writer', 'visitor', 'controller'], undefined],
	['GET', '/dependencies', 'inspector', ['writer', 'visitor'], 404],
	['POST', '/dependencies/checks', 'inspector', ['writer', 'visitor'], 404],
	['POST', '/dependencies/plans', 'inspector', ['writer', 'visitor'], 404],
	['POST', '/dependencies/plans/pln_000000000000000000000000/apply', 'writer', ['inspector', 'visitor'], 404],
	['GET', '/production/packages/shared', 'inspector', ['writer', 'visitor'], 404],
	['POST', '/production/packages/shared/archives', 'inspector', ['writer', 'visitor'], 404],
	['POST', '/production/exports', 'writer', ['inspector', 'visitor'], 404],
	['POST', '/production/packages/shared/publish', undefined, ['inspector', 'writer', 'visitor', 'controller'], undefined]
];

/**
 * The code of a refusal; a `HEAD` answer has no body to carry it
 */
const refusal = (method, response) => [response.status, method === 'HEAD' ? void 0 : response.body.error?.code];

export async function access() {
	const signer = new Signer();
	const grants = {
		inspector: signer.grant('grt_ins0001', ['inspect.read', 'session.read']),
		writer: signer.grant('grt_wri0001', ['files.write', 'files.read']),
		visitor: signer.grant('grt_vis0002', ['artifacts.read', 'events.subscribe']),
		controller: signer.grant('grt_ctl0001', ['build.control'])
	};

	/**
	 * Every route of a table refused without a grant and with the grants it refuses, and let through to its handler
	 * with its own
	 */
	const guarded = async routes => {
		const context = await serve({ 'a.ts': 'one' }, new Access(vectors.verifier));
		try {
			for (const [method, path, allowed, refused, answer] of routes) {
				const anonymous = await context.call(method, path);
				assert.deepEqual(refusal(method, anonymous), [401, method === 'HEAD' ? void 0 : 'GRANT_MALFORMED'], `${method} ${path} without a grant`);
				for (const name of refused) {
					const denied = await context.call(method, path, { grant: grants[name] });
					assert.deepEqual(refusal(method, denied), [403, method === 'HEAD' ? void 0 : 'GRANT_CAPABILITY'], `${method} ${path} with the ${name} grant`);
				}

				// The guard lets the allowed grant through to the route: a stand-in answers, a method none serves is not found
				if (!allowed) continue;
				const through = await context.call(method, path, { grant: grants[allowed] });
				assert.equal(through.status, answer, `${method} ${path} with the ${allowed} grant`);
			}
		} finally {
			context.stop();
		}
		return `${routes.length} routes: refused without a grant and with another capability, answered with theirs`;
	};

	await step('installation-and-resolution-need-grants: the installation is read with inspect.read and run with files.write, the resolution documents need artifacts.read', () => guarded(ROUTES));
	await step('another case or an ending slash is the same route, and needs the same grant', () => guarded(SPELLINGS));
	await step('the features of the hosting service need grants: reading is inspection, changing sources a write, and launching, settings and publishing are refused to every delegated grant', () => guarded(FEATURES));

	await step('local mode (no authority): the installation and the resolution documents need no grant', async () => {
		const context = await serve({ 'a.ts': 'one' });
		try {
			for (const [method, path] of ROUTES.filter(([method]) => method !== 'PUT')) {
				assert.equal((await context.call(method, path)).status, 200, `${method} ${path}`);
			}
		} finally {
			context.stop();
		}
	});
}
