import { Compiler } from '@beyond-js/packages/bundlers/esbuild/processors/bundle';
import type { EntryType, IInventory, IInventoryDiagnostic, IMeasured, ITraceRequest } from './types';
import { Pinned } from './pinned';
import { Tracer } from './tracer';
import { Toolchain } from './toolchain';
import { Compatibility } from './compatibility';
import { Keyed } from './keyed';
import { Specifier } from './specifier';

/**
 * Finds what an application needs before anything is generated.
 *
 * From the entry public modules of the application it follows public references across the packages of a
 * pinned graph whose sources were already fetched, and answers a `beyond-inventory/1`: the reachable
 * public modules, eager or lazy, the stylesheets, the static files, the dynamic imports it could not
 * follow, and for each item the inputs and the value of its compatibility key. A public module nothing
 * reaches is not in it. It writes nothing, keeps no compiled code and returns none, so an inventory can be
 * inspected, stored and compared before a single output exists.
 */
export /*bundle*/ class Analysis {
	static get protocol() {
		return 'beyond-inventory/1';
	}

	/**
	 * The inventory, exactly as the protocol defines it
	 */
	static async trace(request: ITraceRequest): Promise<IInventory> {
		return (await Analysis.measured(request)).inventory;
	}

	/**
	 * The inventory with what tracing it cost and the compiler that read the sources
	 */
	static async measured(request: ITraceRequest): Promise<IMeasured> {
		const started = Date.now();
		const diagnostics: IInventoryDiagnostic[] = [];
		const fail = (code: string, message: string) => diagnostics.push({ code, message, severity: 'error' });
		const pinned = new Pinned(request?.graph, request?.sources, request?.conditions);
		const { conditions } = pinned;

		const done = async (tracer?: Tracer, entries: { id: string; target: string; package: string; subpath: string }[] = [], compiler?: Compiler): Promise<IMeasured> => {
			const items = tracer ? await tracer.run(entries) : [];
			pinned.destroy();

			const document = {
				protocol: <const>'beyond-inventory/1',
				graph: pinned.graph.digest,
				entries: entries.map(({ target, package: key, subpath }) => ({ target, package: key, subpath })),
				items,
				unknown: tracer?.unknown ?? [],
				diagnostics: diagnostics.concat(tracer?.diagnostics ?? [])
			};
			const inventory = Object.assign({ digest: Compatibility.digest(document) }, document);
			const cost = { ms: Date.now() - started, compiled: tracer?.cost.compiled ?? 0, read: tracer?.cost.read ?? 0 };
			return { inventory, cost, compiler: compiler?.identity && { ...compiler.identity } };
		};

		pinned.graph.diagnostics.forEach(({ code, message }) => fail(code, message));
		!['browser', 'node'].includes(conditions.platform) && fail('CONDITIONS_INVALID', 'The platform condition must be "browser" or "node"');
		const format = request?.format ?? 'esm';
		!['esm', 'system'].includes(format) && fail('FORMAT_UNSUPPORTED', `The format must be "esm" or "system" (found: ${JSON.stringify(format)})`);
		if (!(request?.entries instanceof Array) || !request.entries.length) {
			fail('ENTRIES_MISSING', 'An analysis starts from at least one application entry public module');
		}
		if (diagnostics.length) return done();

		const compiler = await Compiler.load(request.compiler, process.cwd());
		if (compiler.error) return fail(compiler.error.code, compiler.error.message), done();

		const tracer = new Tracer(pinned, compiler, new Toolchain(compiler, conditions, format), request.declared);
		const entries = [];
		for (const entry of request.entries) {
			const { specifier, target }: Exclude<EntryType, string> = typeof entry === 'string' ? { specifier: entry } : entry;
			const parsed = new Specifier(specifier);
			const keys = parsed.valid ? pinned.graph.find(parsed.name, parsed.version) : [];
			if (keys.length !== 1) {
				const reason = keys.length ? `is pinned ${keys.length} times; select one as "name@version/subpath"` : 'is not in the pinned graph';
				fail('ENTRY_UNRESOLVED', `The package of the entry "${specifier}" ${reason}`);
				continue;
			}

			const landing = await pinned.land(keys[0], Specifier.of(parsed.name, parsed.subpath));
			landing.diagnostics.forEach(({ code, message }) => fail(code, message));
			if (!landing.module) continue;
			const id = tracer.enqueue(landing.opened, landing.module);
			entries.push({ id, target: target ?? (conditions.platform === 'node' ? 'backend' : 'web'), package: keys[0], subpath: Keyed.subpath(parsed.subpath) });
		}

		return done(tracer, entries, compiler);
	}
}
