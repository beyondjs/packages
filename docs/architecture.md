# Architecture and bundlers SDK

Packages turns package/module specifications into conditional artifacts through collaborating objects. Workspace and Package own discovery and configuration; registered bundler implementations select module behavior; conditionals select platform/environment; processors transform sources into outputs. HTTP and other consumers must obtain those outputs through the same object model.

The implementation includes source collections, delegated processing, maps and diagnostics. Final assembly, validity propagation and development integration remain incomplete. This guide describes existing APIs and limitations; [development](development.md) defines the intended service and widget acceptance criteria, and [programming](programming.md) explains authoring conventions.

## Control and data flow

| Step | Actual owner and handoff |
| --- | --- |
| Workspace discovery | [Workspace](../modules/workspace/index.ts) reads beyond.json and constructs Package objects for normalized paths |
| Package configuration | [Package](../modules/package/main/index.ts) initializes manifest attributes, Bundlers, controller and Modules |
| Module specification | [Modules](../modules/package/main/modules/index.ts) combines exports first, then discovered module.json specifications |
| Bundler implementation | [Registry](../modules/package/main/bundlers/index.ts) maps aliases to specifiers/settings; importer expects public `Module` |
| Module instance | [ModuleResolver](../modules/package/main/modules/resolver.ts) constructs `new Module({package, spec, bundler})` |
| Conditional selection | [Conditionals](../modules/module/main/conditionals/index.ts) invokes module `_conditionals()` and `_conditional({key, conditions})` |
| Conditional inputs | [ConditionalSpec](../modules/module/main/conditionals/conditional/spec.ts) invokes conditional `_spec(module.spec.values)` |
| Processor configuration | SDK conditional calls `_processors()`; its collection imports public `Processor` constructors and assigns per-module spec |
| Processing | Each ConditionalProcessor owns settings, specification, sources and a fresh output container per build |
| Conditional result | A concrete conditional assembles or directly produces ConditionalOutput |
| Consumer | Fixtures explicitly await stages and read output; the current HTTP route still uses a stub rather than this object graph |

This is an ownership/dependency path, not a single synchronous function. Readiness at one stage does not establish readiness or semantic validity of all descendants.

The existing configuration distinctions still apply: current finder reads `beyond.modules`; bootstrap manifests use top-level `modules`; registry is top-level `bundlers`; legacy `bundle` wins over `bundler` when both are truthy; exports occupy a subpath before manifests. Project picks one exact local name/version, but the current package dependency provider does not implement a demonstrated workspace-local override. Keep bootstrap authoring configuration distinct from target-package discovery until an explicit compatibility contract connects them.

## Public interfaces: core versus SDK

[Core BaseModule](../modules/module/main/index.ts), exported from `@beyond-js/packages/module`, receives `{package, spec, bundler}` and owns a Conditionals collection. It is not itself a DynamicProcessor. The [SDK BaseModule](../modules/sdk/module/index.ts), exported from `@beyond-js/packages/sdk`, is presently an empty subclass of that core type. It supplies a public extension point, not a second independent module engine.

The core module contract includes:

```ts
_conditionals(): IConditions[];
_conditional({ key, conditions }: { key: string; conditions: IConditions }): BaseConditional;
```

Conditionals validates a string platform and optional string environment, building keys as `platform` or `platform/environment`. It retains an existing conditional for an existing key and destroys removed ones. This is explicit Beyond conditional enumeration, not Node's generic ordered condition resolver.

[BaseConditional](../modules/module/main/conditionals/conditional/index.ts) extends DynamicProcessor, takes `(module, conditions)`, exposes module/platform/environment/spec, requires an output getter and permits `_spec(values): IProcessedSpec`. That result contains `values: object | string` plus optional errors/warnings. ConditionalSpec compares projected values and diagnostics so relevant specification changes can propagate.

The [SDK Conditional](../modules/sdk/conditional/main/index.ts) adds a processor collection and this real authoring interface:

```ts
_processors(): IProcessorsSetup;
// IProcessorsSetup:
// { processors: Map<string, IProcessorSpec>, errors?: IDiagnostic[], warnings?: IDiagnostic[] }
// IProcessorSpec: { specifier: string, [key: string]: any }
```

Its constructor `(module, conditions, strategy?)` permits a replacement `Processors` collection. `_prepared(require)` requires that collection and its processor children. [ESMConditional](../modules/sdk/conditional/esm/index.ts) is a concrete assembly strategy, discussed below. A bundler can alternatively subclass the core BaseConditional and manage its own tool/output, as the exports bundler does.

## Processor creation, settings and lifecycle

[ConditionalProcessors](../modules/sdk/conditional/processors/base/index.ts) invokes `_processors()`, resolves each implementation, and constructs `new Processor(conditional, name)`. Both the bundler and [processor importers](../modules/sdk/conditional/processors/base/importer.ts) hardcode development bimport loading. A public class called `Module` or `Processor` is required respectively. These are separate aliases/imports, not a function taking arbitrary input bytes.

[ConditionalProcessor](../modules/sdk/conditional/processor/index.ts) takes `(conditional, name, strategy)`. Strategy supplies Settings/Spec overrides, source strategy and optional delegation names. It creates child processors for configuration and sources. Its extension points are:

```ts
_spec(values: any): { values: any; errors?: IDiagnostic[]; warnings?: IDiagnostic[] };
_settings(values: object): { values: object; errors?: IDiagnostic[]; warnings?: IDiagnostic[] };
_build(request: IRequest, outputs: ProcessorOutputs): Promise<void>;
```

[ProcessorSettings](../modules/sdk/conditional/processor/settings.ts) takes values from `bundler.settings.processors[processor.name]`, then calls `_settings`. The default projection returns an empty object: arbitrary package-level options are not automatically consumed. [ProcessorSpec](../modules/sdk/conditional/processor/spec.ts) calls `_spec`, compares results and invalidates on change. The default projection retains path/files for input-enabled processors. Concrete implementations must deliberately retain additional options they use.

The processor's `_process(request)` creates fresh ProcessorOutputs, awaits `_build`, then publishes only if `request === this._request`. This guards against publishing an obsolete asynchronous build; it does not cancel work or undo external side effects. TS currently runs source transformations concurrently against that fresh container.

DynamicProcessor `setup` declares child dependencies; `_prepared(require)` establishes readiness dependencies; `_invalidate` requests reprocessing. These calls use the external DynamicProcessor package. A fulfilled `ready` promise should not be described as a successful compiler result: consumers still need relevant diagnostics and output assertions. Scheduling semantics belong to that dependency; consumers still own their asynchronous side effects and cleanup.

## Sources, delegation and outputs

[ProcessorSources](../modules/sdk/conditional/processor/sources/index.ts) composes three distinct inputs. Its preparation requires individual files and delegated results; its processing computes sorted SHA256 component hashes and an aggregate, with `_hash()` as an extension point.

| Input | Current API and boundary |
| --- | --- |
| [Discovered inputs](../modules/sdk/conditional/processor/sources/inputs/index.ts) | FinderCollection rooted at package path + module spec path + input path; uses extension/include/exclude filters and the package watcher when available |
| [Fixed files](../modules/sdk/conditional/processor/sources/files/index.ts) | Strategy entries `{file, json, File?}` create DynamicFile or DynamicFileObject instances, e.g. auxiliary configuration |
| [Delegated inputs](../modules/sdk/conditional/processor/sources/delegated/index.ts) | Collect outputs from sibling processors in the same conditional, keyed by relative source file |

[DelegatingProcessors](../modules/sdk/conditional/processor/sources/delegated/processors.ts) finds processors whose `delegates` set includes the receiving processor's name, requires those producers and obtains `outputs.delegated.get(receiver)`. This is processor-to-processor data flow. It is not a public module dependency edge or package release selection. This SDK path does not complete public-import graph extraction. Retained `conditional/dependencies` JavaScript and commented TS analyzer hooks cannot establish that connection.

[ProcessorOutputs](../modules/sdk/conditional/processor/outputs/index.ts) has `ims` and `types` collections, one `css: ProcessorOutput`, and delegated collections. [OutputsCollection](../modules/sdk/conditional/processor/outputs/collection.ts) exposes `obtain(file: DynamicFile)` and `update(output: ProcessorOutput)`, indexed by relative filename. Each [ProcessorOutput](../modules/sdk/conditional/processor/outputs/output/index.ts) has source, code and issues. Its code object extends ConditionalOutput with an exports Set.

The [ConditionalOutput](../modules/module/output/index.ts) final value API is:

```ts
set(values: { code: string; map: string | object });
code(output?: 'raw-code' | 'sourcemap-inline');
map(format?: 'string' | 'object' | 'base64');
// hash getter: MD5 of raw code, reset by set()
```

It lazily converts map formats and appends inline maps when requested. Its hash covers code, not map content. It does not schedule builds, aggregate diagnostics, persist an artifact, register a URL or install styles. [IssuesOutput](../modules/sdk/conditional/processor/outputs/output/issues/index.ts) accepts `push('errors' | 'warnings', {code, message, position?})`. Per-source issues are separate from the conditional's own diagnostics.

The types/CSS containers provide an API slot, not completed DTS or stylesheet generation. The TS processor fills IMS; its tsc sibling imports a missing `./exports` and does not implement active semantic compilation/declaration emission. Declaration and stylesheet generation each need active producers, appropriate output identities and a delivery path; containers alone do not implement them.

## Invalidation, validity and cleanup limitations

| Finding | Effect or next evidence needed |
| --- | --- |
| Fixed-file loader includes `file` in both root and final path | An auxiliary tsconfig path becomes `tsconfig.json/tsconfig.json`; test actual loading before assuming configuration dependency works |
| [Input spec](../modules/sdk/conditional/processor/sources/inputs/spec.ts) deletes path/files/excludes from the shared processor spec object | Reprocessing can mutate the configuration being observed; default processor projection also drops excludes |
| Default ConditionalProcessors has no explicit setup dependency on conditional.spec | A parent becoming invalid is not proof that the collection recalculates `_processors()`; test module-spec edits through the whole chain |
| [Optional resolver](../modules/sdk/conditional/processors/resolver/index.ts) reads `bundler.settings.values.processors`, while ProcessorSettings reads `bundler.settings.processors` | Strategies disagree on the settings shape; the optional resolver is not automatically the default collection |
| ConditionalProcessors error branch calls done without updated, but done accesses updated.size | Configuration failure may throw instead of producing the intended diagnostics |
| Import result overwrites errors; constructor catch may then call errors.push on undefined | Import/initialization failure paths need explicit tests; success with another processor can also replace earlier error state |
| Processor collection retains instances by name even when implementation specifier changes | Alias identity alone may leave the previous constructor active after configuration edits |
| Processor.valid consults its private errors, while TS writes output.issues | `valid` does not aggregate build issues; Conditional.valid also omits a complete spec/settings/output diagnostic rollup |
| ConditionalSpec exposes valid as a method, unlike nearby getters | Consumers must not treat it interchangeably with boolean getters |
| DelegationCollector computes but does not store its new hash; delegating processor errors are not published | Delegated invalidation/diagnostics need verification |
| BaseConditional and ConditionalProcessor destroy methods omit super.destroy; SDK Conditional has no explicit processor collection disposal | Listener/child cleanup cannot be assumed; ProcessorSources also destroys optional inputs without a guard |

ModuleResolver additionally caches an existing module instance after confirming the alias is present, before rechecking that bundler's validity/constructor. Changing an implementation under a stable module subpath therefore needs a dedicated replacement test. These details matter more than a blanket statement that DynamicProcessor handles all invalidation automatically.

## Actual TS authoring example

The existing [TS Module](../modules/bundlers/ts/module/index.ts) is the clearest SDK extension example. It reads `platforms`, defaults to `['default']`, and creates an ESM conditional for each platform. The types conditional branch is commented out. Its [ESM subclass](../modules/bundlers/ts/module/esm.ts) returns all spec values and configures one processor named `ts`, using public specifier `@beyond-js/packages/bundlers/ts/processors/ts`. It excludes `platforms` while forwarding other entries.

These are the actual bounded method shapes, excerpted from that implementation; they are not a new runnable bundler:

```ts
_spec(values: Record<string, any>): IProcessedSpec {
    return { values };
}
_processors(): IProcessorsSetup {
    const reserved = ['platforms'];
    const spec: Record<string, any> = {};
    for (const [key, value] of Object.entries(this.spec.values)) {
        if (!reserved.includes(key)) spec[key] = value;
    }
    const specifier = '@beyond-js/packages/bundlers/ts/processors/ts';
    return { processors: new Map([['ts', { specifier, ...spec }]]) };
}
```

The [TS Processor](../modules/bundlers/ts/processors/ts/index.ts) extends ConditionalProcessor and configures `.ts`/`.tsx` inputs plus a JSON `tsconfig.json` auxiliary file. `_build` obtains `outputs.ims.obtain(input)` and concurrently calls Exports.process and Transpiler.process for each input.

[Transpiler](../modules/bundlers/ts/processors/ts/transpiler.ts) uses SWC, ES2022 target, ESM output and source maps; failures add `TRANSPILE_ERROR` to output issues. The loaded tsconfig is not read by this transformation. [Exports](../modules/bundlers/ts/processors/ts/exports.ts) separately parses source and recognizes `/*bundle*/` on supported class/function/identifier variable declarations. Default expressions are explicitly unsupported; its parser does not configure TSX as the transpiler does, and parse rejection is not caught there. Analyzer/dependency construction is commented out in the processor constructor.

The current SDK ESM assembly wraps each IM in a creator function but uses literal `id`/`hash` placeholders and does not supply the complete registration/runtime envelope. SWC emits ESM syntax, which is then placed inside those functions. Thus per-file transpilation and a resulting code string are not proof of valid executable public-module ESM, retained imports, or working exports. This is a specific assembly gap, not a reason to discard source/output abstractions.

To author another bundler against this design, expose a public Module, register its specifier under a package alias, choose conditionals, project their spec, then either configure SDK Processors or produce a core ConditionalOutput directly. Reuse these signatures and explicitly define source/options/error handling. Do not assume subclassing the unfinished ESMConditional makes the new bundler executable.

## Exports bundler: a different path

The [exports Module](../modules/bundlers/exports/index.ts) extends the core BaseModule directly and enumerates only `node`. Its [conditional](../modules/bundlers/exports/conditional.ts) reads `spec.node.require`, invokes esbuild and writes ConditionalOutput itself. It bypasses SDK source/processor collections.

The [esbuild plugin](../modules/bundlers/exports/plugin.ts) resolves local relative files from package/importer directories, reads them from disk, and marks bare or URL references external. The [wrapper](../modules/bundlers/exports/wrapper.ts) adapts CommonJS output and discovered exports into an ESM wrapper. This is one concrete reference-preserving mechanism, not the package-version resolver or a completed public module dependency graph.

Only out.js and its map are collected; CSS siblings are not. The build uses `platform: 'browser'` despite the node conditional label, and writes a debug `output.js` in the working directory. General Node exports alternatives, types and styles are not implemented by merely declaring them in package.json. Simple target shapes lacking node.require can fail during spec access before the later NO_TARGET diagnostic. A node label alone does not establish Node-targeted compilation.

## Consumers and the hello-world distinction

| Consumer | What its source actually exercises |
| --- | --- |
| [hello-world fixture](../tests/test-bundlers/hello-world/index.js) | Loads Package, registry and the TS Module constructor; module/conditional/output traversal is commented out. No separate hello-world bundler is implemented by this fixture |
| [TS fixture](../tests/test-bundlers/ts/index.js) | Awaits package, registry, modules, conditionals and default conditional, then prints `conditional.output.code('sourcemap-inline')` |
| [esbuild fixture](../tests/test-bundlers/esbuild/index.js) | Selects `./utils`, node conditional and prints output; the broader exports manifest is not equivalent to all alternatives being exercised |
| [new hello assertion](../tests/hello/index.mjs) | Asserts Engine-produced HTTP ESM through BEE Node; it does not execute the newer SDK packaging path |
| [HTTP module route](../modules/http/routes/modules/index.ts) | Parses options and returns a generated hello stub; it does not resolve Package/Module/ConditionalOutput |

The three older bundler fixtures use legacy BEE with server port 1110 and inspector 4000, log results, and catch errors without assertion-based failure handling. The TS and hello-world fixture package manifests still use top-level modules, conflicting with the newer finder. These fixtures are evidence of intended consumption, not passing end-to-end tests. HTTP headers advertising maps/DTS/CSS are also not proof those outputs exist or are served.


## Extension and validation

Use current TypeScript entrypoints and their active imports when extending the SDK. `_older`, `_to-refactor`, `_older-to-be-refactored`, `to-be-refactored-processor-packager` and `trash` contain retained designs. An import of the older `@beyond-js/bundlers-sdk` identity is not the current public SDK contract. Some retained JavaScript also lives outside these names, so follow actual import reachability.

For a bundler extension, validate these boundaries:

1. Discover its manifest and instantiate its registered public Module and Processor; assert source identity, projected spec/settings and auxiliary-file path.
2. Build a source into IMS and verify code, map, marked exports and structured parse/transform errors. All errors must reach the consumer, regardless of the current valid getter.
3. Edit/remove a source and change processor options/specifier; verify relevant stages rerun, newer requests win and stale outputs disappear.
4. Validate delegated producer/consumer behavior, including cycles, missing producers and changed hashes.
5. Produce an executable conditional artifact with public imports/exports before connecting it to HTTP. Assert the bytes come from that exact output.
6. Verify cleanup after module/conditional/processor removal. Prove DTS/CSS separately when their producers and delivery paths exist.

## Runtime artifact contract

An outer ECMAScript public module and internal module composition are separate layers. Beyond source files inside a public module can be transformed into creator functions indexed by stable internal identities and hashes. The public artifact still imports other public modules through bare specifiers. A compatible runtime owns existing package/internal instances and export bindings; a patch updates that state rather than silently creating an independent registry.

The current ESMConditional does not finish that contract. Completing it requires valid transformed creator code, actual identities/hashes, public export metadata, dependency registration and the runtime update envelope consumed by widgets/styles/HMR. An `export` declaration inside a creator function is invalid JavaScript; a valid plain ESM file without required consumer metadata is also insufficient for the existing runtime integration.

Keep three relationships distinct: internal source imports/evaluation, public module imports, and package/version selection. Processor delegation is a fourth, build-local flow between processors. None automatically supplies another graph's identities or invalidation behavior.

## Services and reusable library access

The existing public objects support a future shared artifact service, but no completed high-level artifact-service API is currently exposed. That service must resolve explicit package/workspace context, public subpath, target/environment and output kind; await the selected conditional; surface diagnostics; and return actual code/map/type/style output with its identity. HTTP adapters should consume it without duplicating packaging logic.

The local development server owns watcher bootstrap, request defaults, update publication and application bootstrap. An independent CDN consumer owns its storage, caching, authorization, session policy and deployment. Library imports must not implicitly start those services. Preserve public bare references and select runtime/editor resolution consistently. The [development guide](development.md) describes the remaining HTTP, widget, types, style and HMR work.
