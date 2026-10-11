import type { IPreviewModule } from './types';
import type { IProbed, Probe } from './probe';

/**
 * The part of a description the CDN's answers change
 */
interface IChecked {
	modules: IPreviewModule[];
	importmap: { imports: Record<string, string>; scopes?: Record<string, Record<string, string>>; integrity?: Record<string, string> };
	updates: { runtime?: string; session?: object; reason?: string };
}

/**
 * Binds the addresses a preview gives on the CDN (under the `cdn` externals policy) to what the CDN answered.
 *
 * Every address on the CDN (an absolute one: this environment's are relative to the document) is checked with
 * [Probe](./probe.ts) before the document gives it to a browser, and only an output the CDN answered with itself,
 * with the digest of its bytes, keeps its address: the import map pins that digest as the `integrity` of the address,
 * so a browser loads those bytes or nothing. Anything else is `unresolved`, leaves the import map, and has nothing put
 * in its place, neither this environment's build nor another version:
 *
 * - **Missing** (`PREVIEW_CDN_MISSING`): the CDN answered that it has no such output.
 * - **Unverified** (`PREVIEW_CDN_UNVERIFIED`): the CDN answered with something the address cannot be bound to (a
 *   redirect, another media type, no digest).
 * - **Unavailable** (`PREVIEW_CDN_UNAVAILABLE`): no answer within the bound, unreachable, or 5xx. It is an outage and
 *   says so, not a refusal; the address is not given unchecked, and the next description asks again.
 *
 * Where an importer's scope gave it a version the CDN cannot serve while the page imports another one, the scope maps
 * the specifier to a module that throws the reason, so the importer never falls back to the version of the page. A
 * stylesheet that cannot be bound leaves the import map and the module's `stylesheets`, with the same codes.
 */
export class Availability {
	static #CODES = { missing: 'PREVIEW_CDN_MISSING', unverified: 'PREVIEW_CDN_UNVERIFIED', unavailable: 'PREVIEW_CDN_UNAVAILABLE' };

	#probe: Probe;
	#origin: string;

	/**
	 * @param origin The configured CDN origin, which the messages name
	 */
	constructor(probe: Probe, origin: string) {
		this.#probe = probe;
		this.#origin = origin;
	}

	static #remote(url: string | undefined): boolean {
		return typeof url === 'string' && /^https?:\/\//.test(url);
	}

	/**
	 * @param report Receives a diagnostic of the description
	 * @returns What the CDN answered for the address of each module that has one on the CDN, by its record
	 */
	async apply(checked: IChecked, report: (code: string, message: string) => void): Promise<Map<IPreviewModule, IProbed>> {
		const { modules, importmap } = checked;
		const urls = [
			...modules.map(({ url }) => url),
			...modules.flatMap(({ stylesheets }) => (stylesheets ?? []).map(({ url }) => url)),
			...Object.values(importmap.imports),
			...Object.values(importmap.scopes ?? {}).flatMap(scope => Object.values(scope))
		].filter(Availability.#remote);
		const probed = await this.#probe.check(urls);
		const bound = (url: string) => !Availability.#remote(url) || probed.get(url)?.state === 'present';
		const answers: Map<IPreviewModule, IProbed> = new Map();

		for (const module of modules) {
			const answer = Availability.#remote(module.url) ? probed.get(module.url) : void 0;
			answer && answers.set(module, answer);
			answer && answer.state !== 'present' && this.#unbound(module, answer, report);

			if (!module.stylesheets) continue;
			const kept = module.stylesheets.filter(({ url }) => bound(url));
			for (const { specifier, url } of module.stylesheets.filter(({ url }) => !bound(url))) this.#report(specifier, url, probed.get(url), report);
			kept.length ? (module.stylesheets = kept) : delete module.stylesheets;
		}

		this.#map(importmap, bound, url => Availability.#CODES[<'missing' | 'unverified' | 'unavailable'>(probed.get(url)?.state ?? 'unavailable')]);
		const pinned = Object.fromEntries([...probed].filter(([, answer]) => answer.state === 'present').map(([url, answer]) => [url, answer.integrity]));
		Object.keys(pinned).length && (importmap.integrity = { ...importmap.integrity, ...pinned });

		const runtime = checked.updates.runtime && modules.find(({ specifier }) => specifier === checked.updates.runtime);
		if (runtime?.source === 'unresolved') {
			checked.updates.reason = `The development coordinator of the runtime (${runtime.specifier}) cannot be loaded from the CDN, so nothing applies updates to the running page`;
			delete checked.updates.runtime;
			delete checked.updates.session;
		}
		return answers;
	}

	#report(specifier: string, url: string, answer: IProbed | undefined, report: (code: string, message: string) => void): void {
		const state = answer?.state === 'present' || !answer ? 'unavailable' : answer.state;
		const address = url.split('?')[0];
		const messages = {
			missing: `"${specifier}" is not on the CDN (${this.#origin} answered HTTP ${answer?.status} for ${address}), and no other source takes its place`,
			unverified: `"${specifier}" cannot be bound to what the CDN answered for ${address}: ${answer?.reason}; no other source takes its place`,
			unavailable: `"${specifier}" could not be checked: the CDN (${this.#origin}) ${this.#cause(answer)}; it has no address until the CDN answers`
		};
		report(Availability.#CODES[state], messages[state]);
	}

	#cause(answer: IProbed | undefined): string {
		return answer?.status ? `answered HTTP ${answer.status}` : `did not answer within ${this.#probe.timeout} ms`;
	}

	#unbound(module: IPreviewModule, answer: IProbed, report: (code: string, message: string) => void): void {
		this.#report(module.specifier, module.url, answer, report);
		const reasons = {
			missing: `The CDN does not hold this output (HTTP ${answer.status}): it has no address`,
			unverified: `The CDN's answer cannot be bound to this address (${answer.reason}): it has no address`,
			unavailable: `The CDN ${this.#cause(answer)} when this address was checked: it has no address until the CDN answers`
		};
		delete module.url;
		module.source = 'unresolved';
		module.reason = reasons[<'missing' | 'unverified' | 'unavailable'>answer.state];
	}

	/**
	 * Takes the outputs that cannot be bound out of the import map
	 */
	#map(importmap: IChecked['importmap'], bound: (url: string) => boolean, code: (url: string) => string): void {
		const { imports, scopes } = importmap;
		Object.entries(imports).forEach(([specifier, url]) => !bound(url) && delete imports[specifier]);
		if (!scopes) return;

		for (const [prefix, scope] of Object.entries(scopes)) {
			for (const [specifier, url] of Object.entries(scope)) {
				if (bound(url)) continue;
				// A scope without the specifier would fall back to the version the page imports: it fails instead
				if (imports[specifier] === void 0) delete scope[specifier];
				else scope[specifier] = Availability.#throwing(`${code(url)}: "${specifier}" (${url.split('?')[0]}) cannot be loaded from the CDN`);
			}
			!Object.keys(scope).length && delete scopes[prefix];
		}
		!Object.keys(scopes).length && delete importmap.scopes;
	}

	static #throwing(reason: string): string {
		return `data:text/javascript,${encodeURIComponent(`throw new Error(${JSON.stringify(`[beyond preview] ${reason}`)});`)}`;
	}
}
