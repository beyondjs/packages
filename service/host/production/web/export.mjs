import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import { ProductionError } from '../error.mjs';
import { Addresses } from './addresses.mjs';
import { Destination } from './destination.mjs';
import { Manifest } from './manifest.mjs';
import { Outputs } from './outputs.mjs';
import { Page } from './page.mjs';
import { Staging } from './staging.mjs';
import { Target } from './target.mjs';

/**
 * The web export of a frontend execution target (`production.export`): a directory a static host serves as it is,
 * holding the page's document (`index.html`), the production output of every module the page loads (eagerly or
 * lazily), their stylesheets and declared assets, and its manifest (`beyond-export.json`).
 *
 * | Strategy | What is written | What the page references |
 * | --- | --- | --- |
 * | `self-contained` | Every output the page needs | Nothing outside the export |
 * | `cdn` | The workspace's own modules (and the toolchain's, which no registry publishes) | Installed packages on the configured CDN origin, each pinned by the integrity of the digest the CDN answered for it |
 *
 * The work is in steps: `target` (the catalog resolves the target; the destination is checked), `graph` (the page's
 * graph is described for the strategy, as a preview of the entry with every module of the workspace in development),
 * `outputs` ([Outputs](./outputs.mjs)), and `write` (staged under `.beyond/production/staging/<id>`, moved into the
 * destination once complete, recorded). A request that cannot be honoured fails with its code: an unknown target, a
 * conflicting destination (`details.replace` names the earlier export of the same target that `replace` may name),
 * an unsupported strategy, a module without a source or a production output.
 */
export class WebExport {
	static STEPS = Object.freeze([
		{ id: 'target', expected: { median: 300, p90: 2000 } },
		{ id: 'graph', expected: { median: 3000, p90: 20000 } },
		{ id: 'outputs', expected: { median: 10000, p90: 60000 } },
		{ id: 'write', expected: { median: 300, p90: 3000 } }
	]);
	static STRATEGIES = Object.freeze(['self-contained', 'cdn']);

	/**
	 * What an export made without an installed graph is
	 */
	static DEVELOPMENT = 'This export was made from the packages the development service supplies, without an installed graph, so it is for trying the page only: it is not what beyond build produces, and CI cannot reproduce it. Install the workspace (beyond install) to export what a build makes';
	static #BASE = /^\/([A-Za-z0-9._~-]+\/)*$/;

	#root;
	#context;

	/**
	 * @param {string} root The canonical root of the workspace
	 * @param {{delivery: object, services: {get(name: string): any}, describe: (entry: object, strategy: string, origin?:
	 * string) => Promise<object>, members: () => string[], records: import('./records.mjs').Records, origin: () =>
	 * string | undefined, toolchain: object, clock?: {now(): number}}} context How the page's graph is described for a
	 * strategy, the members' directories, the CDN origin configured, and what the manifest names of the toolchain
	 */
	constructor(root, context) {
		this.#root = root;
		this.#context = { clock: Date, ...context };
	}

	/**
	 * Reads and checks a request's fields, without reading the workspace
	 *
	 * @param {object} body
	 * @returns {{application: string, target: string, strategy: string, destination: string, base: string, replace?:
	 * string, entry?: string}}
	 * @throws {ProductionError} `REQUEST_INVALID`, `EXPORT_DESTINATION_INVALID`
	 */
	request(body) {
		const { application, target, strategy = 'self-contained', destination, base = '/', replace, entry } = body;
		Target.check({ application, target });
		if (!WebExport.STRATEGIES.includes(strategy)) throw new ProductionError('REQUEST_INVALID', `"strategy" is "self-contained" or "cdn", not "${String(strategy).slice(0, 40)}"`);
		const normalized = typeof base === 'string' && !base.endsWith('/') ? `${base}/` : base;
		if (typeof normalized !== 'string' || !WebExport.#BASE.test(normalized) || normalized.split('/').some(segment => segment === '.' || segment === '..')) {
			throw new ProductionError('REQUEST_INVALID', '"base" is the path the export is served under, such as "/" or "/app/"');
		}
		if (replace !== undefined && (typeof replace !== 'string' || !/^exp_[0-9a-f]{24}$/.test(replace))) throw new ProductionError('REQUEST_INVALID', '"replace" names an earlier export by its identifier');
		const resolved = new Destination(this.#root, this.#context.members()).resolve(destination, { application, target });
		const managed = resolved.managed ? { managed: true } : {};
		return { application, target, strategy, destination: resolved.relative, ...managed, base: normalized, ...(replace ? { replace } : {}), ...(entry !== undefined ? { entry } : {}) };
	}

	/**
	 * @param {import('../../operations/operation.mjs').Operation} operation
	 * @param {ReturnType<WebExport['request']>} request
	 */
	async run(operation, request) {
		const { delivery, services, describe, records, origin, toolchain, clock } = this.#context;
		const { strategy, base, replace } = request;
		const id = `exp_${randomBytes(12).toString('hex')}`;

		const step = operation.step('target').begin();
		const target = await new Target(services).resolve(request);
		const destination = new Destination(this.#root, this.#context.members()).resolve(request.managed ? void 0 : request.destination, request);
		await destination.check({ ...target, replace });
		const cdn = strategy === 'cdn' ? this.#cdn(delivery, origin()) : void 0;
		step.done();

		operation.step('graph').begin().current(target.entry.specifier);
		const description = await WebExport.#described(() => describe(target.entry, strategy, cdn));
		operation.step('graph').done();

		const outputs = operation.step('outputs').begin({ phase: 'production' });
		const walked = await new Outputs({ delivery, description, addresses: new Addresses(base), remote: strategy === 'cdn' }).walk(outputs, operation.signal);
		if (walked.diagnostics.length) {
			const only = walked.diagnostics.every(({ code }) => code === 'EXPORT_PRODUCTION_UNAVAILABLE');
			const code = only ? 'EXPORT_PRODUCTION_UNAVAILABLE' : 'EXPORT_GRAPH_INCOMPLETE';
			throw new ProductionError(code, `The page of ${target.application}/${target.target} cannot be exported: ${walked.diagnostics[0].message}`, { diagnostics: walked.diagnostics });
		}
		outputs.done();

		const writing = operation.step('write').begin();
		const page = new Page({ title: target.title ?? `${target.application}/${target.target}`, entry: target.entry.specifier, importmap: walked.importmap, links: walked.links }).html;
		const files = [...walked.files, { file: 'index.html', kind: 'document', content: page }];
		// Without an installed graph the outputs come from what the development supplies: not what beyond build makes
		const plan = delivery.execution ? 'installed' : 'development';
		const manifest = Manifest.of({
			id,
			target,
			strategy,
			base,
			plan,
			files,
			provenance: (await delivery.provenance?.().catch(() => [])) ?? [],
			...(cdn ? { cdn: { origin: cdn, modules: walked.cdn } } : {}),
			installation: await this.#installation(delivery),
			toolchain,
			diagnostics: target.diagnostics,
			created: new Date(clock.now()).toISOString()
		});
		await this.#write({ id, owner: operation.owner }, destination, files, manifest, request, writing, operation.signal);
		const record = { ...manifest, destination: destination.relative, ...(replace ? { replaced: replace } : {}) };
		await records.write(record);
		writing.done();
		const bytes = manifest.files.reduce((total, file) => total + file.size, 0);
		const development = plan === 'development' ? { developmentOnly: true, reason: WebExport.DEVELOPMENT } : {};
		const answer = { id, application: target.application, target: target.target, strategy, base, destination: destination.relative, files: manifest.files.length, bytes, manifest: Manifest.FILE, plan, ...development };
		return { export: answer, manifest };
	}

	/**
	 * The CDN origin a `cdn` export references: an installed workspace serves every node of its graph itself, and an
	 * export without a configured origin has nothing to reference
	 */
	#cdn(delivery, origin) {
		if (delivery.execution) throw new ProductionError('EXPORT_STRATEGY_UNSUPPORTED', 'The workspace is installed (beyond install): every node of its graph is served by this environment, so the "cdn" strategy has no external package to reference. Export it "self-contained"');
		if (!origin) throw new ProductionError('EXPORT_STRATEGY_UNSUPPORTED', 'No CDN origin is set: the "cdn" strategy references external packages there. Set it in Settings (cdn.origin), or export it self-contained', { setting: 'cdn.origin', variable: 'BEYOND_CDN_ORIGIN' });
		return origin;
	}

	/**
	 * The page's description, whose refusals are the export's
	 */
	static async #described(describe) {
		try {
			return await describe();
		} catch (error) {
			if (error instanceof ProductionError) throw error;
			const code = error?.code === 'PREVIEW_ENTRY_NOT_FOUND' || error?.code === 'PREVIEW_ENTRY_REQUIRED' ? 'TARGET_UNRESOLVED' : 'EXPORT_GRAPH_INCOMPLETE';
			// A refusal of the development contract carries its details in its body
			const diagnostics = error?.details?.diagnostics ?? error?.body?.error?.diagnostics;
			throw new ProductionError(code, error?.message ?? String(error), { cause: error?.code, ...(diagnostics ? { diagnostics } : {}) });
		}
	}

	/**
	 * The state of the installed graph the outputs were compiled from, and the digest of its lock
	 */
	async #installation(delivery) {
		const state = delivery.projection?.state;
		let lock;
		try {
			lock = JSON.parse(await readFile(join(this.#root, 'beyond-lock.json'), 'utf8')).digest;
		} catch {
			// A workspace that was never installed has no lock
		}
		return { state: state ?? 'missing', ...(typeof lock === 'string' ? { lock } : {}) };
	}

	/**
	 * Writes the export in its staging directory, which names the host that writes it before anything is staged, and
	 * moves it into the destination
	 */
	async #write({ id, owner }, destination, files, manifest, request, step, signal) {
		const staging = new Staging(this.#root, id, owner);
		try {
			await staging.claim();
			let done = 0;
			for (const { file, content } of files) {
				if (signal?.aborted) throw signal.reason;
				const target = join(staging.path, ...file.split('/'));
				if (!target.startsWith(`${staging.path}${sep}`)) throw new ProductionError('EXPORT_GRAPH_INCOMPLETE', `"${file}" is not a path inside the export`);
				await mkdir(dirname(target), { recursive: true });
				await writeFile(target, content);
				step.count(++done, files.length + 1, 'files');
			}
			await writeFile(join(staging.path, Manifest.FILE), `${JSON.stringify(manifest, null, '\t')}\n`);
			// The manifest is the last file: the count reaches its total
			step.count(files.length + 1, files.length + 1, 'files');
			// Another export may have written the destination while this one ran
			await destination.check({ application: request.application, target: request.target, replace: request.replace });
			await destination.commit(staging);
		} finally {
			await staging.clear();
		}
	}
}
