import { join } from 'node:path';
import { Deadline } from '../../deadline.mjs';
import { ProductionError } from './error.mjs';
import { Members } from './members.mjs';
import { Archives } from './packing/archives.mjs';
import { Preflight } from './preflight/index.mjs';
import { Credentials } from './registry/credentials.mjs';
import { Publisher } from './registry/publisher.mjs';
import { Publishing } from './registry/publishing.mjs';
import { Registry } from './registry/registry.mjs';
import { WebExport } from './web/export.mjs';
import { Records } from './web/records.mjs';
import { Selected } from './web/selected.mjs';
import { Staging } from './web/staging.mjs';

/**
 * What the production routes do, on one workspace: the preflight of a package, its archive, its status at a registry
 * and its publication, and the web export of a frontend target, each work that takes long run as an operation of the
 * host (`operations.run`), so it lives on the service and a reload or a lost answer finds it again.
 *
 * ```js
 * const production = new Production(context, { modules });
 * await production.preflight('packages%2Fui');
 * await production.pack('packages/ui', key);              // {operation, created}
 * ```
 */
export class Production {
	/**
	 * How long the preflight waits for the generated declaration of one public module (`BEYOND_DECLARATION_TIMEOUT`),
	 * which compiles it when it was not built yet
	 */
	static DECLARATION = 60000;
	static #declaration = new Deadline('BEYOND_DECLARATION_TIMEOUT', Production.DECLARATION);

	#context;
	#modules;
	#members;
	#archives;
	#records;
	#credentials;
	#registry;
	#publishing;
	#exporter;

	/**
	 * @param {object} context What the host gives its features (see `Features`)
	 * @param {{modules: import('./modules.mjs').Modules, publisher?: Publisher, fetch?: typeof fetch}} options How
	 * Packages' modules are loaded, and stand-ins of npm and of the network for a test
	 */
	constructor(context, { modules, publisher, fetch }) {
		const { root, environment = process.env } = context;
		this.#context = context;
		this.#modules = modules;
		this.#members = new Members(root);
		this.#archives = new Archives(root);
		this.#records = new Records(root);
		this.#credentials = new Credentials({ root, environment, load: options => modules.settings(options) });
		this.#registry = new Registry({ credentials: this.#credentials, environment, ...(fetch ? { fetch } : {}) });
		const npm = publisher ?? new Publisher({ cwd: root, environment });
		this.#publishing = new Publishing({ registry: this.#registry, publisher: npm, archives: this.#archives });
		this.#exporter = new WebExport(root, {
			delivery: context.workspace,
			services: context.services,
			describe: (entry, strategy, origin) => this.#describe(entry, strategy, origin),
			members: () => this.#members.declared.map(({ path }) => path),
			records: this.#records,
			origin: () => this.#origin(),
			toolchain: context.toolchain ?? { node: process.versions.node }
		});
	}

	get archives() {
		return this.#archives;
	}

	/**
	 * Puts right what an earlier run left: archives past their retention are removed, and an export the service stopped
	 * in the middle of is recovered (`Staging.recover`)
	 */
	async start() {
		await this.#archives.sweep();
		await Staging.recover(this.#context.root, this.#records);
	}

	get records() {
		return this.#records;
	}

	/**
	 * The CDN origin a `cdn` export references: the local Dev Server setting `cdn.origin` when the settings feature
	 * shares one, else `BEYOND_CDN_ORIGIN`
	 */
	#origin() {
		const shared = this.#context.services.get('settings');
		const configured = typeof shared?.value === 'function' ? shared.value('cdn.origin') : void 0;
		const origin = configured ?? this.#context.environment?.BEYOND_CDN_ORIGIN;
		return typeof origin === 'string' && origin.trim() ? origin.trim().replace(/\/+$/, '') : void 0;
	}

	/**
	 * The page of an entry as a preview describes it, with every module of the workspace in development and the
	 * externals of the strategy, whatever the development selection of the person is
	 */
	async #describe(entry, strategy, origin) {
		const { Preview } = await this.#modules.development();
		const environment = { ...this.#context.environment, BEYOND_CDN_ORIGIN: origin ?? '' };
		const selection = new Selected(strategy === 'cdn' ? 'cdn' : 'environment');
		const preview = new Preview(this.#context.workspace, selection, this.#context.settings?.runtime?.base, environment);
		return preview.describe(entry.vspecifier ?? entry.specifier);
	}

	/**
	 * The subpaths of the Beyond public modules the workspace publishes for a package, and how its generated declaration
	 * is asked for
	 */
	async #beyond(member) {
		const delivery = this.#context.workspace;
		const published = (await delivery.published?.().catch(() => [])) ?? [];
		const own = published.filter(module => module.path === member.directory && module.name === member.manifest.name);
		const declarations = this.#context.services.get('declarations');
		const bound = Production.#declaration.read(this.#context.environment ?? process.env);
		const declaration = async subpath => {
			const specifier = `${member.manifest.name}@${member.manifest.version}${subpath === '.' ? '' : subpath.slice(1)}`;
			if (!declarations) return { state: 'absent', code: 'DECLARATION_NOT_FOUND' };
			let timer;
			const expired = new Promise(resolve => (timer = setTimeout(resolve, bound, 'expired')));
			try {
				const read = await Promise.race([declarations.read(specifier), expired]);
				if (read === 'expired') return { state: 'unknown', code: 'DECLARATION_TIMEOUT', message: `The declaration was not produced within ${bound} ms`, variable: 'BEYOND_DECLARATION_TIMEOUT' };
				return { state: 'generated', provenance: 'generated' };
			} catch (error) {
				if (error?.code === 'DECLARATION_INVALID') return { state: 'invalid', code: 'DECLARATION_INVALID', message: error.message };
				const producer = /no "types" conditional/.test(error?.message ?? '');
				return { state: 'absent', code: producer ? 'DECLARATION_PRODUCER_MISSING' : 'DECLARATION_NOT_FOUND' };
			} finally {
				clearTimeout(timer);
			}
		};
		return { published: own.map(({ subpath }) => subpath), declaration };
	}

	/**
	 * The preflight of a package
	 *
	 * @param {string} reference
	 */
	async preflight(reference) {
		const member = this.#members.resolve(reference);
		const { Publication, Exports } = await this.#modules.publication();
		const { published, declaration } = await this.#beyond(member);
		const modules = { Publication, Exports, members: this.#members.declared, published, declaration, registry: manifest => this.#credentials.registry(manifest, member.directory) };
		return new Preflight(member, modules, join(this.#context.root, '.beyond', 'production', 'preflight')).read();
	}

	/**
	 * Packs a package: `production.pack`
	 *
	 * @param {string} reference
	 * @param {string} [key] The request identifier
	 */
	pack(reference, key) {
		const member = this.#members.resolve(reference);
		const specs = { kind: 'production.pack', ...(key ? { key } : {}), scope: { member: member.id }, steps: [{ id: 'archive', expected: { median: 1000, p90: 5000 } }] };
		return this.#context.operations.run(specs, async operation => {
			const step = operation.step('archive').begin().current(`${member.manifest.name}@${member.manifest.version}`);
			const record = await this.#archives.create(member);
			step.count(record.files.length, record.files.length, 'files').done();
			return { archive: record };
		});
	}

	/**
	 * The registry a request names, or the one the package goes to
	 */
	async #target(member, registry) {
		if (registry === undefined) return (await this.#credentials.registry(member.manifest, member.directory)).url;
		const normalized = Credentials.normalized(registry);
		if (!normalized) throw new ProductionError('REQUEST_INVALID', '"registry" is the http or https address of a registry');
		return normalized;
	}

	/**
	 * Reads a package version's status at a registry: `production.status`
	 *
	 * @param {string} reference
	 * @param {{registry?: unknown, archive?: unknown}} body
	 * @param {string} [key]
	 */
	async status(reference, { registry, archive }, key) {
		const member = this.#members.resolve(reference);
		const url = await this.#target(member, registry);
		const record = archive === undefined ? void 0 : await this.#archives.get(archive, member.id);
		const { name, version } = member.manifest;
		const specs = { kind: 'production.status', ...(key ? { key } : {}), scope: { member: member.id }, steps: [{ id: 'registry', expected: { median: 1000, p90: 5000 } }] };
		return this.#context.operations.run(specs, async operation => {
			const step = operation.step('registry').begin().current(`${name}@${version} at ${url}`);
			const status = await this.#registry.status({ name, version, registry: url, archive: record, directory: member.directory });
			step.done();
			return { status };
		});
	}

	/**
	 * Publishes an archive: `production.publish`
	 *
	 * @param {string} reference
	 * @param {{archive?: unknown, registry?: unknown, access?: unknown, tag?: unknown, confirm?: unknown}} body
	 * @param {string} [key]
	 */
	async publish(reference, body, key) {
		const member = this.#members.resolve(reference);
		const registry = Credentials.normalized(body.registry);
		if (!registry) throw new ProductionError('REQUEST_INVALID', '"registry" is the http or https address the package is published to');
		if (!['public', 'restricted'].includes(body.access)) throw new ProductionError('REQUEST_INVALID', '"access" is "public" or "restricted"');
		const tag = body.tag ?? 'latest';
		if (typeof tag !== 'string' || !/^[A-Za-z][A-Za-z0-9._-]{0,63}$/.test(tag)) throw new ProductionError('REQUEST_INVALID', '"tag" is a distribution tag, such as "latest" or "next"');
		const archive = await this.#archives.get(body.archive, member.id);
		const { confirm } = body;
		const confirmed = confirm && typeof confirm === 'object' && confirm.name === archive.name && confirm.version === archive.version && Credentials.normalized(confirm.registry) === registry;
		if (!confirmed) {
			throw new ProductionError('CONFIRMATION_MISMATCH', `The confirmation must repeat what is published: {"name": "${archive.name}", "version": "${archive.version}", "registry": "${registry}"}`);
		}
		const specs = { kind: 'production.publish', ...(key ? { key } : {}), scope: { member: member.id, name: archive.name, version: archive.version, registry }, steps: Publishing.STEPS };
		return this.#context.operations.run(specs, operation => this.#publishing.run(operation, { archive, registry, access: body.access, tag, directory: member.directory }));
	}

	/**
	 * Exports a frontend target: `production.export`
	 *
	 * @param {object} body
	 * @param {string} [key]
	 */
	export(body, key) {
		const request = this.#exporter.request(body);
		const specs = { kind: 'production.export', ...(key ? { key } : {}), cancellable: true, scope: { application: request.application, target: request.target, destination: request.destination }, steps: WebExport.STEPS };
		return this.#context.operations.run(specs, operation => this.#exporter.run(operation, request));
	}
}
