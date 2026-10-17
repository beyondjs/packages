import { Caller } from '../pairing/caller.mjs';
import { Journal } from './journal.mjs';

/**
 * The service log (`GET /logs`, capability `logs`): what the host logs, the end of every build, the reloads of the
 * workspace, the start and end of every launch, the changes of the settings and the test runs, from the host's
 * `Journal`. See `docs/service.md#the-service-log`.
 *
 * | Route | Answer |
 * | --- | --- |
 * | `GET /logs?after=<cursor>&limit=<n>` | `200 {entries: [{cursor, at, level, source, message}], cursor}`, at most 500 entries |
 *
 * On a service that pairs, a paired page and a local tool read it; a local consumer is refused (`files.read`), since a
 * log names the sources and their errors. A service that verifies delegated grants (`BEYOND_AUTHORITY`) mounts nothing.
 *
 * ```js
 * const logs = services.get('logs');
 * logs.follow(services.get('log'));   // the development extension's event log, for the builds
 * ```
 */
export class Feature {
	static NAME = 'logs';
	static MAXIMUM = 500;

	#journal;
	#enabled;
	#unsubscribe = [];

	/**
	 * @param {{journal?: Journal, events?: import('../events.mjs').Events, services?: import('../features.mjs').Services,
	 * environment?: object}} context What the host gives every feature, with its journal
	 */
	constructor({ journal = new Journal(), events, services, environment = process.env }) {
		this.#journal = journal;
		this.#enabled = !environment.BEYOND_AUTHORITY;
		if (!this.#enabled) return;
		services?.set(Feature.NAME, this);
		events && this.#unsubscribe.push(events.subscribe((type, data) => this.#host(type, data)));
	}

	get journal() {
		return this.#journal;
	}

	get capabilities() {
		return this.#enabled ? { logs: 1 } : {};
	}

	/**
	 * Follows the event log of the development extension for the ends of builds
	 *
	 * @param {{subscribe: (listener: (event: object) => void) => () => void} | undefined} source
	 */
	follow(source) {
		const unsubscribe = source?.subscribe?.(event => event?.type === 'build.ended' && this.#build(event.build ?? {}));
		unsubscribe && this.#unsubscribe.push(unsubscribe);
	}

	#build({ state, diagnostics = [] }) {
		if (state === 'failed') {
			const [first] = diagnostics;
			const where = first?.file ? `${first.file}${first.range ? `:${first.range.line}:${first.range.column}` : ''}: ` : '';
			const count = `${diagnostics.length} problem${diagnostics.length === 1 ? '' : 's'}`;
			return this.#journal.add('error', 'build', `The build failed with ${count}${first ? `. ${where}${first.message}` : ''}`);
		}
		if (state === 'completed') this.#journal.add('info', 'build', 'The build compiled');
	}

	#host(type, data) {
		if (type === 'launch.changed') return this.#launch(data?.launch ?? {});
		if (type === 'workspace.changed') return this.#journal.add('info', 'service', 'The declarations of the workspace changed and were read again');
		if (type === 'settings.changed') return this.#journal.add('info', 'service', 'The settings changed');
	}

	#launch({ id, application, target, state, exit, failure, reason }) {
		const name = `${application}/${target}`;
		const source = `launch:${id}`;
		if (state === 'running') return this.#journal.add('info', source, `${name} started`);
		if (state === 'ready') return this.#journal.add('info', source, `${name} is ready`);
		if (state === 'exited') return this.#journal.add('info', source, `${name} ended${exit?.code !== undefined && exit?.code !== null ? ` with code ${exit.code}` : ''}`);
		if (state === 'failed') return this.#journal.add('error', source, `${name} failed: ${failure?.message ?? reason?.message ?? 'it ended by itself'}`);
	}

	/**
	 * @param {import('express').Application} app
	 */
	setup(app) {
		if (!this.#enabled) return;
		app.get('/logs', (request, response) => {
			response.set('cache-control', 'no-store');
			const refusal = Caller.of(request)?.refusal('files.read');
			if (refusal) return response.status(refusal.status).json({ error: { code: refusal.code, message: refusal.message } });
			const number = (value, fallback) => (/^\d{1,15}$/.test(String(value ?? '')) ? Number(value) : fallback);
			const after = number(request.query.after, 0);
			const limit = Math.min(Math.max(number(request.query.limit, Feature.MAXIMUM), 1), Feature.MAXIMUM);
			response.json(this.#journal.read({ after, limit }));
		});
	}

	stop() {
		this.#unsubscribe.forEach(unsubscribe => unsubscribe());
		this.#unsubscribe = [];
	}
}
