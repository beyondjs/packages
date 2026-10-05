/**
 * Stand-ins for what the installation routes of a host use: the declaration of the workspace (`Declaration.read`),
 * the projection of its installed graph (`Execution.read`), the class that installs (`Installation`, given through
 * a loader) and the hosted workspace that is reloaded after an installation wrote its projection. A case decides
 * what each one does, and the stand records what was asked of it.
 *
 * - `projection`: the state `Execution.read` answers (`ready` has an execution of three nodes).
 * - `kind`, `valid`, `declaration: 'conflict'`: the declaration (`npm` by default, two members).
 * - `written`, `valid`: what the installation report says.
 * - `reload: 'unavailable'`: the reload after the installation does not settle.
 * - `held`: each installation waits for `release()`.
 * - `failing`: how many installations reject before they start answering reports.
 */
export class Stand {
	#declaration;
	#settings;
	#installations = [];
	#reads = [];
	#reloads = 0;
	#loads = 0;
	#declarations = 0;
	#failures;
	#gate;
	#open;
	#waiting = [];
	#Installation;

	constructor({ projection = 'missing', kind = 'npm', valid = true, declaration, written = true, reload = 'ready', held = false, failing = 0 } = {}) {
		this.#settings = { projection, written, valid, reload };
		this.#failures = failing;
		this.#declaration = declaration === 'conflict' ? Stand.#conflict() : Stand.#valid(kind);
		this.#gate = held ? new Promise(resolve => (this.#open = resolve)) : Promise.resolve();
		this.#Installation = this.#installation();
	}

	static #valid(kind) {
		const manifest = kind === 'standalone' ? void 0 : { name: 'root', private: true, workspaces: ['app', '../widget'] };
		const members = kind === 'standalone'
			? [{ id: '.', name: '@fixture/app', version: '1.0.0', path: '/ws', manifest: { name: '@fixture/app', version: '1.0.0' }, source: 'standalone' }]
			: [
				{ id: 'app', name: '@fixture/app', version: '1.0.0', path: '/ws/app', manifest: { name: '@fixture/app', version: '1.0.0' }, source: 'workspaces' },
				{ id: '../widget', name: '@fixture/widget', version: '2.0.0', path: '/widget', manifest: { name: '@fixture/widget', version: '2.0.0' }, source: 'workspaces' }
			];
		const inputs = { declaration: 'sha256-declaration', members: Object.fromEntries(members.map(({ id }) => [id, `sha256-${id}`])) };
		return { kind, valid: true, manifest, members, diagnostics: [], inputs };
	}

	static #conflict() {
		const message = 'The members are declared in beyond.json and in package.json; declare them in one of them';
		const diagnostics = [{ code: 'WORKSPACE_CONFIG_CONFLICT', message, severity: 'error', paths: ['/ws/beyond.json', '/ws/package.json'] }];
		return { kind: 'npm', valid: false, manifest: {}, members: [], diagnostics, inputs: { declaration: 'sha256-conflict', members: {} } };
	}

	/**
	 * The class that installs, which records each installation in this stand
	 */
	#installation() {
		const stand = this;
		return class Installation {
			#params;
			constructor(params) {
				this.#params = params;
			}
			async install(options) {
				stand.#installations.push({ params: this.#params, options });
				stand.#waiting.splice(0).forEach(waiter => waiter());
				await stand.#gate;
				if (stand.#failures-- > 0) throw new Error('the stand-in failed');
				return stand.report;
			}
		};
	}

	get declaration() {
		return this.#declaration;
	}

	/**
	 * The report every installation answers
	 */
	get report() {
		const { written, valid } = this.#settings;
		return {
			protocol: 'beyond-installation/1',
			valid,
			frozen: false,
			lock: { path: '/ws/beyond-lock.json', digest: 'sha256-lock', written },
			execution: { path: '/ws/.beyond/execution.json', written },
			counts: { members: 2, nodes: 3, fetched: 1, reused: 0 },
			diagnostics: []
		};
	}

	/**
	 * The installations that started: the parameters of the instance and the options of `install()`
	 */
	get installations() {
		return this.#installations;
	}

	/**
	 * What each read of the projection was given
	 */
	get reads() {
		return this.#reads;
	}

	get reloads() {
		return this.#reloads;
	}

	/**
	 * How many times the declaration was read
	 */
	get declarations() {
		return this.#declarations;
	}

	/**
	 * How many times the class that installs was loaded
	 */
	get loads() {
		return this.#loads;
	}

	get hosted() {
		return {
			reload: async () => {
				this.#reloads++;
				if (this.#settings.reload !== 'unavailable') return;
				throw Object.assign(new Error('The workspace is being reloaded and was not ready within 60ms'), { code: 'UNAVAILABLE' });
			}
		};
	}

	get modules() {
		const Declaration = { read: () => (this.#declarations++, this.#declaration) };
		const Execution = { PATH: '.beyond/execution.json', LOCK: 'beyond-lock.json', read: async (root, current) => this.#read(current) };
		const installation = async () => {
			this.#loads++;
			return this.#Installation;
		};
		return { Declaration, Execution, installation };
	}

	#read(current) {
		this.#reads.push(current);
		const { projection: state } = this.#settings;
		if (state === 'missing') return { state, diagnostics: [{ code: 'EXECUTION_GRAPH_MISSING', message: 'not installed', severity: 'error' }] };

		const nodes = new Map([['workspace:app', {}], ['workspace:../widget', {}], ['npm:react@19.1.1', {}]]);
		return { state, diagnostics: [], execution: { nodes, written: '2026-10-05T10:00:00.000Z' } };
	}

	/**
	 * Resolves once the given number of installations started
	 */
	started(count) {
		return new Promise(resolve => {
			const check = () => (this.#installations.length >= count ? resolve() : this.#waiting.push(check));
			check();
		});
	}

	/**
	 * Lets the held installations end
	 */
	release() {
		this.#open?.();
	}

	/**
	 * Makes the declaration invalid from now on
	 */
	invalidate() {
		this.#declaration = Stand.#conflict();
	}
}
