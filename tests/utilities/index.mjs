/**
 * Utilities validation: which copy of each utility the implementation runs on, and whether a watched change
 * still reaches the compilation after many edits, failures, stylesheet changes and manifest reloads.
 *
 * It runs on a temporary copy of `fixture/` under BEE Node, with the real watchers service and the workspace
 * of the development service, and reports the identity of every utility module it loaded, so that a result is
 * always attributable to the utilities that produced it.
 *
 * ```sh
 * BEE_URL=<implementation>[,<utility>…] WATCHERS_URL=<watchers> \
 *   node --import "$BEE_NODE_DIR/register.mjs" tests/utilities/index.mjs
 * ```
 *
 * `BEYOND_ROUNDS` sets how many times each scenario runs (three by default): the behaviour these scenarios
 * check was intermittent, and one passing round is not evidence of a repair.
 */
import { cp, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WatchersService } from '@beyond-js/packages/watchers';
import { WatcherClient } from '@beyond-js/watchers/client';
import { Hosted } from '../../service/host/hosted.mjs';
import { results, step } from '../stage-1/harness.mjs';
import { destroyed, emitter, identities, isolation } from './regressions.mjs';
import { Scenarios } from './scenarios.mjs';

const { WATCHERS_URL } = process.env;
if (!WATCHERS_URL) throw new Error('Set WATCHERS_URL to the Engine server that serves the watchers utility.');

const rounds = Number(process.env.BEYOND_ROUNDS ?? 3);
if (!(rounds >= 1)) throw new Error('BEYOND_ROUNDS must be a whole number of rounds, at least 1');

const here = dirname(fileURLToPath(import.meta.url));
const root = await realpath(await mkdtemp(join(tmpdir(), 'beyond-utilities-')));
await cp(join(here, 'fixture'), root, { recursive: true });

const service = new WatchersService('watchers', { env: { BEE_URL: WATCHERS_URL } });
let hosted;
let watcher;

try {
	await step('identities: the utility modules this run executed', async () => {
		const loaded = identities();
		for (const [specifier, url] of Object.entries(loaded)) console.log(`       ${specifier} ← ${url}`);
		const served = Object.values(loaded).filter(url => url.startsWith('http')).length;
		return `${served} of ${Object.keys(loaded).length} served from a development server`;
	});

	await step('emitter ownership: a subclass that emits its own event reaches its subscribers', emitter);

	await step('watchers service and workspace: the fixture is served', async () => {
		await service.start();
		watcher = new WatcherClient('watchers', { is: 'test', path: root });
		await watcher.start();

		hosted = new Hosted({ root, standalone: false }, message => console.log(`       service: ${message}`));
		await hosted.ready;
		const published = await hosted.published();
		return published.map(one => one.specifier).sort().join(', ');
	});

	await step('finder lifetime: a finder destroyed inside its announcement window announces nothing', () => destroyed(watcher));

	await step('listener isolation: a subscriber that throws does not keep the event from being announced', () =>
		isolation(watcher)
	);

	const scenarios = new Scenarios({ root, hosted });
	for (let round = 1; round <= rounds; round++) {
		await step(`round ${round}, edit: an edited source is compiled again`, () => scenarios.edit(round));
		await step(`round ${round}, recovery: a failed build is reported and its correction is compiled`, () =>
			scenarios.recovery(round)
		);
		await step(`round ${round}, stylesheet: a stylesheet of another package invalidates what reads it`, () =>
			scenarios.stylesheet(round)
		);
		await step(`round ${round}, manifest: a reload releases its watchers and the new ones answer the next edit`, () =>
			scenarios.manifest(round)
		);
	}

	await step('the service is still usable: every declared module is delivered', () => scenarios.usable());
} finally {
	// The clients release their watchers before the service they are registered in ends
	watcher?.destroy();
	hosted?.destroy();
	await new Promise(resolve => setTimeout(resolve, 500));
	await service.stop().catch(error => console.log(`watchers: ${error.message}`));
	await rm(root, { recursive: true, force: true });
}

const passed = results.filter(result => result.ok).length;
console.log(`\n${passed}/${results.length} steps passed`);
process.exit(passed === results.length ? 0 : 1);
