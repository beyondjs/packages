import { Admission } from './admission.mjs';

/**
 * The HTTP mapping of the installation of the hosted workspace: `GET /installation` describes it and
 * `POST /installation` (`{update?, offline?}`) runs one (see `Installer`).
 *
 * The answers are for the service's own clients, never for a page of another origin: they carry no
 * cross-origin header, a preflight is answered without one, and a request to install passes `Admission` first.
 * Mount these routes before the routes of the compiled-module contract, whose answers any origin may read.
 */
export class InstallationRoutes {
	/**
	 * The largest body a request to install may have, in bytes
	 */
	static LIMIT = 16 * 1024;

	static #OPTIONS = ['update', 'offline'];

	#installer;
	#admission;

	/**
	 * @param {import('./installer.mjs').Installer} installer
	 * @param {{bind?: string}} [options] The address the service listens on, the loopback one by default
	 */
	constructor(installer, { bind } = {}) {
		this.#installer = installer;
		this.#admission = new Admission({ bind });
	}

	/**
	 * Sends an answer that no page of another origin may read, whatever was set before this route
	 */
	static #answer(response, status, body) {
		response.removeHeader('access-control-allow-origin');
		response.removeHeader('access-control-expose-headers');
		response.status(status).set('cache-control', 'no-store').json(body);
	}

	/**
	 * The options of a request to install, which are booleans or absent. Anything else is refused rather than
	 * read as a default: a misspelled option must not install in a way that was not asked for.
	 *
	 * @returns {{options?: {update?: boolean, offline?: boolean}, error?: string}}
	 */
	static #options(body) {
		if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'The options of an installation must be a JSON object' };
		const unknown = Object.keys(body).filter(name => !InstallationRoutes.#OPTIONS.includes(name));
		if (unknown.length) return { error: `Unknown installation option "${unknown[0]}" (expected: ${InstallationRoutes.#OPTIONS.join(', ')})` };
		const invalid = InstallationRoutes.#OPTIONS.find(name => body[name] !== undefined && typeof body[name] !== 'boolean');
		if (invalid) return { error: `The installation option "${invalid}" must be true or false` };
		return { options: body };
	}

	/**
	 * The parsed body of a request, read within the size limit. An empty body is no options. A body that a parser
	 * mounted before these routes already read is taken as it parsed it, never as an empty one.
	 */
	static async #body(request) {
		if (request.body && typeof request.body === 'object' && !Buffer.isBuffer(request.body)) return request.body;

		const chunks = [];
		let size = 0;
		for await (const chunk of request) {
			if ((size += chunk.length) > InstallationRoutes.LIMIT) throw Object.assign(new Error('too large'), { limit: true });
			chunks.push(chunk);
		}
		const text = Buffer.concat(chunks).toString('utf8').trim();
		return text ? JSON.parse(text) : {};
	}

	async #install(request, response) {
		const refusal = this.#admission.refusal(request);
		if (refusal) return InstallationRoutes.#answer(response, refusal.status, { error: refusal.error });

		const refuse = message => InstallationRoutes.#answer(response, 400, { error: { code: 'OPTION_INVALID', message } });
		let body;
		try {
			body = await InstallationRoutes.#body(request);
		} catch (error) {
			const limit = `The options of an installation are limited to ${InstallationRoutes.LIMIT} bytes`;
			return refuse(error.limit ? limit : 'The options of an installation must be a JSON document');
		}

		const { options, error } = InstallationRoutes.#options(body);
		if (error) return refuse(error);
		const { status, body: answer } = await this.#installer.install(options);
		InstallationRoutes.#answer(response, status, answer);
	}

	/**
	 * Mounts `GET /installation`, `POST /installation` and the answer to their preflight
	 *
	 * @param {import('express').Application} app
	 */
	setup(app) {
		app.options('/installation', (request, response) => {
			response.removeHeader('access-control-allow-origin');
			response.set('allow', 'GET, POST').status(204).end();
		});
		app.get('/installation', (request, response, next) =>
			this.#installer.describe().then(value => InstallationRoutes.#answer(response, 200, value), next)
		);
		app.post('/installation', (request, response, next) => this.#install(request, response).catch(next));
	}
}
