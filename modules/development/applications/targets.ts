import type { ICatalogTarget } from './types';
import { Diagnostics } from './diagnostics';

const plain = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const quoted = (value: unknown) => JSON.stringify(value);

/**
 * The rules of one execution target of the declaration: its identifier, the fields it declares and what follows from
 * them (the public specifier of its entry and the environment its consumer runs in). Identifiers and the fields CDN
 * also has (`kind`, `package`, `entry`, `conditions`, `selection`, `runtime`) follow CDN's patterns, so the same
 * declaration describes the target's publication. A target with errors is still listed, with what could be read.
 */
export class Targets {
	static ID = /^[a-z][a-z0-9-]{0,31}$/;
	static PACKAGE = /^([a-z][a-z0-9-]*:)?(@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;
	static ENTRY = /^\.(\/[A-Za-z0-9@_-][A-Za-z0-9@._-]*)*$/;
	static CONDITION = /^[a-z][a-z0-9-]*$/;
	static RUNTIME = /^(node|deno)(?![A-Za-z0-9_-])/;
	static FIELDS = new Set(['title', 'kind', 'package', 'entry', 'conditions', 'selection', 'runtime', 'readiness']);
	static LIMITS = { title: 80, selection: 256, runtime: 80, readiness: 200 };

	/**
	 * Reads one target of an application
	 */
	read(id: string, value: unknown): ICatalogTarget {
		const diagnostics = new Diagnostics();
		const target = <ICatalogTarget>{ id };
		if (!Targets.ID.test(id)) {
			const message = `${quoted(id)} is not a target identifier: a lowercase letter, then up to 31 lowercase letters, digits or hyphens`;
			diagnostics.error('TARGET_ID_INVALID', message);
		}
		if (!plain(value)) {
			diagnostics.error('TARGET_INVALID', `The target ${quoted(id)} is not an object of its fields`);
			return { ...target, diagnostics: diagnostics.list };
		}

		this.#title(value.title, target, diagnostics);
		this.#kind(value.kind, target, diagnostics);
		this.#entry(value, target, diagnostics);
		this.#conditions(value.conditions, target, diagnostics);
		this.#selection(value.selection, target, diagnostics);
		this.#runtime(value, target, diagnostics);
		this.#readiness(value.readiness, target, diagnostics);
		for (const field of Object.keys(value).filter(field => !Targets.FIELDS.has(field))) {
			diagnostics.warning('TARGET_FIELD_UNKNOWN', `The field ${quoted(field)} is not one this Core knows; it is kept as written`, field);
		}
		return { ...target, diagnostics: diagnostics.list };
	}

	#title(title: unknown, target: ICatalogTarget, diagnostics: Diagnostics) {
		if (title === undefined) return;
		const valid = typeof title === 'string' && !!title.trim() && title.length <= Targets.LIMITS.title;
		typeof title === 'string' && (target.title = title);
		valid || diagnostics.error('TARGET_TITLE_INVALID', 'The title of a target is text of 1 to 80 characters', 'title');
	}

	#kind(kind: unknown, target: ICatalogTarget, diagnostics: Diagnostics) {
		typeof kind === 'string' && (target.kind = kind);
		if (kind === 'frontend' || kind === 'backend') return;
		const message = kind === undefined
			? 'A target declares its kind: "frontend" (a browser document loads it) or "backend" (a server process runs it)'
			: `The kind of a target is "frontend" or "backend", not ${quoted(kind)}`;
		diagnostics.error('TARGET_KIND_INVALID', message, 'kind');
	}

	/**
	 * The package and the entry, and the public specifier they name together: `<package>` for `.`, `<package>/<name>`
	 * for `./<name>`. A package named with its provider (`npm:name`, as CDN accepts it) is imported by its name.
	 */
	#entry({ package: name, entry }: Record<string, unknown>, target: ICatalogTarget, diagnostics: Diagnostics) {
		typeof name === 'string' && (target.package = name);
		typeof entry === 'string' && (target.entry = entry);
		const named = typeof name === 'string' && Targets.PACKAGE.test(name);
		const subpath = typeof entry === 'string' && Targets.ENTRY.test(entry);

		if (!named) {
			const message = name === undefined || name === '' ? 'A target names the package that publishes its entry' : `${quoted(name)} is not a package name`;
			diagnostics.error('TARGET_PACKAGE_REQUIRED', message, 'package');
		}
		if (!subpath) {
			const message = entry === undefined
				? 'A target declares its entry: the public subpath of its package, "." or "./<name>"'
				: `The entry of a target is a public subpath of its package, "." or "./<name>", not ${quoted(entry)}`;
			diagnostics.error('TARGET_ENTRY_INVALID', message, 'entry');
		}
		if (!named || !subpath) return;

		const bare = (<string>name).replace(/^[a-z][a-z0-9-]*:/, '');
		target.specifier = entry === '.' ? bare : `${bare}/${(<string>entry).slice(2)}`;
	}

	#conditions(conditions: unknown, target: ICatalogTarget, diagnostics: Diagnostics) {
		if (conditions === undefined) return;
		const list = Array.isArray(conditions) && conditions.every(one => typeof one === 'string') ? <string[]>conditions : void 0;
		list && (target.conditions = list);
		const valid = list?.every(one => Targets.CONDITION.test(one)) && list.every((one, index) => index === 0 || list[index - 1] < one);
		if (valid) return;
		const message = 'The conditions of a target are a list of names (a lowercase letter, then lowercase letters, digits or hyphens), sorted and unique';
		diagnostics.error('TARGET_CONDITIONS_INVALID', message, 'conditions');
	}

	#selection(selection: unknown, target: ICatalogTarget, diagnostics: Diagnostics) {
		if (selection === undefined) return;
		const valid = typeof selection === 'string' && !!selection.trim() && selection.length <= Targets.LIMITS.selection;
		typeof selection === 'string' && (target.selection = selection);
		const message = 'The selection of a target is the version its publication selects: an exact version, a range or a source, in text';
		valid || diagnostics.error('TARGET_SELECTION_INVALID', message, 'selection');
	}

	/**
	 * Where the consumer of a target runs: a browser for a frontend target, Node or Deno for a backend one, from its
	 * runtime (`node` when it declares none). A runtime the Core cannot launch keeps the declaration valid.
	 */
	#runtime({ kind, runtime }: Record<string, unknown>, target: ICatalogTarget, diagnostics: Diagnostics) {
		typeof runtime === 'string' && (target.runtime = runtime);
		if (kind === 'frontend') {
			target.environment = 'browser';
			const message = 'A frontend target runs in the browser that loads it: only a backend target declares a runtime';
			runtime !== undefined && diagnostics.error('TARGET_RUNTIME_FRONTEND', message, 'runtime');
			return;
		}
		if (kind !== 'backend') return;
		if (runtime === undefined) return void (target.environment = 'node');

		if (typeof runtime !== 'string' || !runtime.trim() || runtime.length > Targets.LIMITS.runtime) {
			const message = 'The runtime of a backend target is "node" or "deno", optionally with a requirement ("node>=22"), at most 80 characters';
			return diagnostics.error('TARGET_RUNTIME_INVALID', message, 'runtime');
		}
		const name = Targets.RUNTIME.exec(runtime)?.[1];
		if (name) return void (target.environment = <'node' | 'deno'>name);
		const message = `The Core launches backend targets in Node or Deno, not ${quoted(runtime)}; the declaration stays valid`;
		diagnostics.warning('TARGET_RUNTIME_UNSUPPORTED', message, 'runtime');
	}

	#readiness(readiness: unknown, target: ICatalogTarget, diagnostics: Diagnostics) {
		if (readiness === undefined) return;
		const output = plain(readiness) ? readiness.output : void 0;
		const valid = plain(readiness) && Object.keys(readiness).length === 1 && typeof output === 'string' && !!output && output.length <= Targets.LIMITS.readiness;
		valid && (target.readiness = { output: <string>output });
		if (valid && target.kind === 'backend') return;
		const message = target.kind === 'backend' || !valid
			? 'The readiness of a backend target is { "output": "<text>" }: the process is ready once its output contains that text (1 to 200 characters)'
			: 'Only a backend target declares readiness: a frontend target is opened, not started';
		diagnostics.error('TARGET_READINESS_INVALID', message, 'readiness');
	}
}
