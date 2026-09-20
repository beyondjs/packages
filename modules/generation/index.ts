import type { IDiagnostic } from '@beyond-js/packages/types';
import { Compiler } from '@beyond-js/packages/bundlers/esbuild/processors/bundle';
import { Pinned, DistributedPackage, Keyed, Specifier } from '@beyond-js/packages/analysis';
import type { FormatType, IGenerated, IGenerationRequest } from './types';
import { Unit } from './unit';
import { Prebuilt } from './prebuilt';

/**
 * Generates the outputs of exactly one item of an inventory.
 *
 * A call never compiles more than one public module and never writes anything: the outputs, with their
 * media types, digests, relations and provenance, are returned for the caller to persist. A module
 * published as sources or as an ordinary npm package is compiled with the selected compiler; a distributed
 * module and a static file are read and verified. A unit that fails returns its diagnostics and no output.
 * The key of every output is the key of the inventory item it satisfies, so what was looked up before
 * generating is what is stored after it.
 */
export /*bundle*/ class Generation {
	static get formats(): FormatType[] {
		return ['esm', 'system'];
	}

	static #validate(request: IGenerationRequest): IDiagnostic[] {
		const diagnostics: IDiagnostic[] = [];
		const { item, format, conditions } = request ?? <IGenerationRequest>{};
		if (!item || typeof item.package !== 'string' || typeof item.subpath !== 'string' || !['module', 'style', 'asset'].includes(item.kind)) {
			diagnostics.push({ code: 'ITEM_INVALID', message: 'A unit is generated for one inventory item, with its "kind", "package" and "subpath"' });
		}
		if (!Generation.formats.includes(format)) {
			diagnostics.push({ code: 'FORMAT_UNSUPPORTED', message: `The format must be one of ${Generation.formats.join(', ')} (found: ${JSON.stringify(format)})` });
		}
		if (!['browser', 'web', 'node'].includes(conditions?.platform)) {
			diagnostics.push({ code: 'CONDITIONS_INVALID', message: 'The platform condition must be "browser" or "node"' });
		}
		return diagnostics;
	}

	static async unit(request: IGenerationRequest): Promise<IGenerated> {
		const warnings: IDiagnostic[] = [];
		const invalid = Generation.#validate(request);
		if (invalid.length) return { outputs: [], diagnostics: invalid, warnings };

		const { item, format } = request;
		const pinned = new Pinned(request.graph, request.sources, request.conditions);
		try {
			if (pinned.graph.diagnostics.length) return { outputs: [], diagnostics: pinned.graph.diagnostics, warnings };

			const { opened, diagnostics } = await pinned.open(item.package);
			if (!opened) return { outputs: [], diagnostics, warnings };

			const distribution = opened instanceof DistributedPackage ? await opened.distribution : void 0;
			const prebuilt = new Prebuilt(opened, pinned.conditions, format);
			if (item.kind === 'asset') return await prebuilt.asset(item.subpath, distribution);

			const found = await opened.module(Keyed.declared(item.subpath), pinned.conditions);
			if (!found.module) return { outputs: [], diagnostics: found.diagnostics, warnings };
			const frozen = item.inputs?.resolution ?? {};

			// The stylesheet of a module is an output of the unit of its owner
			const only = item.kind === 'style' && found.module.kind === 'module' ? 'css' : void 0;
			if (distribution) {
				// The resolution slice is established the way tracing does: by following what the module references
				const resolution: Record<string, string> = {};
				for (const { specifier } of found.module.distributed.references) {
					const name = new Specifier(specifier).name;
					const landing = await pinned.land(opened.key, specifier, { key: frozen[name] });
					if (landing.opened) resolution[name] = landing.opened.key;
				}
				return await prebuilt.module(distribution, found.module, resolution, only);
			}

			const compiler = await Compiler.load(request.compiler, process.cwd());
			if (compiler.error) return { outputs: [], diagnostics: [compiler.error], warnings };
			return await new Unit(pinned, opened, found.module, compiler, format, frozen).run(only);
		} finally {
			pinned.destroy();
		}
	}
}
