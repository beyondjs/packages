# Architecture and bundlers SDK

The [CDN integration contract](cdn-contract.md) distinguishes existing builders and development HTTP delivery from required independent analysis, immutable inventories and published adapter parity. Historical fixture limitations below do not negate current Delivery/Declarations capabilities.

The [Dev Server/File API contract](development-server.md) assigns these services to Packages, including source revisions, external changes and events. Workspace owns central administration and Docker placement/access; project containers validate delegated authorization without owning users/roles. Preserve existing public compatibility; inspector is not a separate product component.

Packages turns package/module specifications into conditional artifacts through collaborating objects. Workspace and Package own discovery and configuration; registered bundler implementations select module behavior; conditionals select platform/environment; processors transform sources into outputs. HTTP and other consumers must obtain those outputs through the same object model.

The implementation includes source collections, delegated processing, ESM assembly, maps, diagnostics and Delivery-backed development integration. Complete CDN analysis, npm compatibility, style/asset outputs and semantic Diagnostics remain required work. This guide describes existing APIs and limitations; [development](development.md) defines the intended service and widget acceptance criteria, and [programming](programming.md) explains authoring conventions.

## Control and data flow

| Step | Actual owner and handoff |
| --- | --- |
| Workspace discovery | [Workspace](../modules/workspace/index.ts) reads beyond.json and constructs Package objects for normalized paths |
| Package configuration | [Package](../modules/package/main/index.ts) initializes manifest attributes, Bundlers, controller and Modules |
| Module declaration | [Declarations](../modules/package/main/modules/declarations.ts) combines each exports entry with the manifest of the same subpath, applies the package default bundler and reports contradictions; [Modules](../modules/package/main/modules/index.ts) owns the resulting specifications |
| Bundler implementation | [Registry](../modules/package/main/bundlers/index.ts) maps aliases to specifiers/settings; importer expects public `Module` |
| Module instance | [ModuleResolver](../modules/package/main/modules/resolver.ts) awaits the selected bundler and constructs `new Module({package, spec, bundler})`, replacing the instance when its implementation changes |
| Conditional selection | [Conditionals](../modules/module/main/conditionals/index.ts) invokes module `_conditionals()` and `_conditional({key, conditions})` |
| Conditional inputs | [ConditionalSpec](../modules/module/main/conditionals/conditional/spec.ts) invokes conditional `_spec(module.spec.values)` |
| Processor configuration | SDK conditional calls `_processors()`; its collection imports public `Processor` constructors and assigns per-module spec |
| Processing | Each ConditionalProcessor owns settings, specification, sources and a fresh output container per build |
| Conditional result | A concrete conditional assembles or directly produces ConditionalOutput |
| Artifact | [ESMConditional](../modules/sdk/conditional/esm/index.ts) assembles the internal modules into the executable artifact of the module and its update |
| Consumer | [Artifacts](../modules/artifacts/index.ts) writes the artifacts of a workspace with an import map; [Delivery](../modules/artifacts/delivery.ts) compiles selected modules for the development HTTP adapter |

This is an ownership/dependency path, not a single synchronous function. Readiness at one stage does not establish readiness or semantic validity of all descendants.

The existing configuration distinctions still apply: current finder reads `beyond.modules`; bootstrap manifests use top-level `modules`; registry is top-level `bundlers`; legacy `bundle` wins over `bundler` when both are truthy. Exports entries pointing to source files declare Beyond public modules (entry point = public API) and the manifest of the same subpath adds its specification and bundler selection; `beyond.bundler` is the package default bundler. Project picks one exact local name/version, but the current package dependency provider does not implement a demonstrated workspace-local override. Keep bootstrap authoring configuration distinct from target-package discovery until an explicit compatibility contract connects them.

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

[ConditionalProcessors](../modules/sdk/conditional/processors/base/index.ts) invokes `_processors()`, resolves each implementation, and constructs `new Processor(conditional, name)`. The bundler and [processor importers](../modules/sdk/conditional/processors/base/importer.ts) use native dynamic imports under the running loader. A public class called `Module` or `Processor` is required respectively. These are separate aliases/imports, not a function taking arbitrary input bytes.

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
| Processor import failures are now added to the collected diagnostics instead of replacing them | Repaired; a configuration with several processors reports every failure |
| Processor collection retains instances by name even when implementation specifier changes | Alias identity alone may leave the previous constructor active after configuration edits |
| Processor.valid consults its private errors, while TS writes output.issues | `valid` does not aggregate build issues; Conditional.valid also omits a complete spec/settings/output diagnostic rollup |
| ConditionalSpec exposes valid as a method, unlike nearby getters | Consumers must not treat it interchangeably with boolean getters |
| DelegationCollector computes but does not store its new hash; delegating processor errors are not published | Delegated invalidation/diagnostics need verification |
| BaseConditional and ConditionalProcessor destroy methods omit super.destroy; SDK Conditional has no explicit processor collection disposal | Listener/child cleanup cannot be assumed; ProcessorSources also destroys optional inputs without a guard |

ModuleResolver now awaits the selected bundler before instantiating a module and replaces the instance when the implementation behind the same name changes, so these two concerns are repaired. The remaining findings above are still open. They matter more than a blanket statement that DynamicProcessor handles all invalidation automatically.

## Actual TS authoring example

The TypeScript bundler is the reference SDK extension, and the one that compiles the modules of a target package. Its [TS Module](../modules/bundlers/ts/module/index.ts) is the clearest example of the extension contract. It reads `platforms`, defaults to `['default']`, and creates an ESM conditional for each platform. The types conditional branch is commented out. Its [ESM subclass](../modules/bundlers/ts/module/esm.ts) returns all spec values and configures one processor named `ts`, using public specifier `@beyond-js/packages/bundlers/ts/processors/ts`. It excludes `platforms` while forwarding other entries.

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

[Transpiler](../modules/bundlers/ts/processors/ts/transpiler.ts) uses TypeScript `transpileModule` (CommonJS module output, ES2022 target, per-file source maps, no type checking); diagnostics become `TRANSPILE_ERROR` issues with positions. CommonJS with assignment-style exports is required by the runtime internal-module contract: getter-defined exports (SWC's CommonJS output) cannot be re-created by the installed Kernel on a patch. The [analyzer](../modules/bundlers/ts/processors/ts/analyzer.ts) reads the emitted body with `cjs-module-lexer` to record the exported names, `export *` re-exports and bare dependencies. The loaded tsconfig is not read by this transformation. The magic-comment export extractor was removed: target packages expose their public API through the entry point's ordinary exports.

The SDK [ESM assembly](../modules/sdk/conditional/esm/index.ts) emits the executable artifact through its [assembler](../modules/sdk/conditional/esm/assembler.ts): internal modules identified by `./relative/path` with 32-bit content hashes, sorted for stable output; bare imports preserved and registered in the runtime package; the exports descriptor and `export let` live bindings of the entry internal module; `__beyond_pkg`/`hmr` handles; `initialise(ims)` for the artifact and `update(ims)` for the patch. Processor issues are aggregated into the conditional diagnostics and no output is exposed while errors exist.

To author another bundler against this design, expose a public Module, register its specifier under a package alias, choose conditionals, project their spec, then either configure SDK Processors or produce a core ConditionalOutput directly. Reuse these signatures and explicitly define source/options/error handling. Do not assume subclassing the unfinished ESMConditional makes the new bundler executable.

## esbuild bundler: the packaging mode (trial)

The [esbuild Module](../modules/bundlers/esbuild/module/index.ts) compiles a public module in the esbuild packaging mode, the counterpart of the runtime composition the TypeScript bundler produces. A module selects it like any bundler, through `bundler` in its manifest or the package default, so two modules of one package can use different modes and keep the same public address. It enumerates each declared platform twice: for development use and as a `platform/production` conditional that is minified.

Its [conditional](../modules/bundlers/esbuild/module/packaged.ts) extends the SDK Conditional with one processor, so the files of the module directory are watched inputs like those of any other bundler. The [bundle processor](../modules/bundlers/esbuild/processors/bundle/index.ts) bundles the entry point into one native ES module. Its [boundary](../modules/bundlers/esbuild/processors/bundle/boundary.ts) keeps every bare specifier as a public reference, bundles relative files and package-private `#imports`, and turns a relative import of another public entry of the same package into a reference to that module, so two artifacts never hold separate copies of one state. The conditional exposes `output` and an `artifact` with `composition: 'packaged'`, no internal modules, the bundled `inputs`, the public `stars` it re-exports and the `compiler`; it has no `patch`. [Artifacts](../modules/artifacts/index.ts) and [Delivery](../modules/artifacts/delivery.ts) accept a conditional without a patch and report the composition of every artifact.

The [compiler](../modules/bundlers/esbuild/processors/bundle/compiler.ts) is selected explicitly in the bundler's package settings (`processors.bundle.compiler`). The value is an installed package name or a `file:` URL, which the running loader resolves; a path starting with `./` or `../`, resolved against the root of the package that declares it; or `env:NAME`, the value of that environment variable, which must be an absolute path, a `file:` URL or a package name, so one manifest serves checkouts placed differently. There is no default and no fallback: a module that selects none, or names a variable that is not set, reports `COMPILER_NOT_SELECTED`. The artifact reports the value as declared, the resolved version and location, a capability probe that tells the Beyond fork from upstream, and the fork's provenance when present. This repository's own `esbuild` dependency belongs to the exports bundler and is not what a packaged module is built with unless it is selected.

This is a trial validated by [its own run](../tests/esbuild-packaging/README.md) on Node. It produces and rebuilds packaged artifacts; it does not deliver or apply updates to a running consumer, and it has no styles, types, framework source adapters, CommonJS adapters or published-package closure. It compiles one public module at a time and nothing else: Beyond divides code by public module, so neither this bundler nor anything built on it splits a module into private chunks or compiles several modules together. The development runtime (`local-2026`) is compiled with it, which [its validation](../tests/unified-runtime/README.md) executes.

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
| [stage-1 validation](../tests/stage-1/README.md) | Executes this path end to end on two packages: declaration, bundler selection, conditions, assembly, artifacts, dependency resolution, watched rebuilding and the update of a running consumer, with the corresponding failure cases |
| [esbuild packaging trial](../tests/esbuild-packaging/README.md) | Executes the esbuild bundler on copies of the testbed: resolved compiler identity, per-module mode selection in both directions, a production conditional and a watched development rebuild with its reload boundary |
| [HTTP module route](../modules/http/routes/modules/index.ts) | Uses the artifact-api codec and Delivery for workspace development ESM; rejects unsupported outputs explicitly |

The stage-1 validation is the current reference consumer. The three older bundler fixtures use legacy BEE with server port 1110 and inspector 4000, log results, and catch errors without assertion-based failure handling. The TS and hello-world fixture package manifests still use top-level modules, conflicting with the newer finder. These fixtures are evidence of intended consumption, not passing end-to-end tests. HTTP headers advertising maps/DTS/CSS are also not proof those outputs exist or are served.


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

An outer ECMAScript public module and its internal composition are separate layers. The artifact is a native ES module: it imports other public modules by bare specifier and publishes live bindings. Its own sources are not separate ES modules at runtime, but creator functions registered in the runtime package under a stable identity and a content hash. That composition is what lets an update replace the code of one source file while the public module keeps its identity, its consumers and the rest of its state.

[ESMConditional](../modules/sdk/conditional/esm/index.ts) and its [assembler](../modules/sdk/conditional/esm/assembler.ts) implement that contract and produce two outputs from the same internal modules: the artifact, which creates the runtime package and initialises it, and the update, which obtains the package already registered under the same identity and replaces the creators whose hash changed. Consumers read the identities, public API, dependencies and internal hashes of the result through the conditional `artifact` property.

The runtime an artifact is written against is the public module it imports first. It is the legacy Kernel, `@beyond-js/kernel/bundle`, unless the package selects another one as `runtime` in the settings of its bundler (`"bundlers": { "ts": { "specifier": "…", "runtime": "@scope/package/bundle" } }`); a value that is not a specifier is `RUNTIME_INVALID`. The artifact reports its `runtime`, and [Dependencies](../modules/artifacts/dependencies.ts) classifies that specifier as the runtime, never version-checked, also when the workspace itself provides it. [The unified-runtime validation](../tests/unified-runtime/README.md) composes a workspace against the development runtime this way.

Two boundaries follow from the runtime contract and are respected by the current producers. The exports of an internal module must be assignments on its `exports` object, because the runtime empties and refills that object when it re-creates it; an emitter that defines exports as accessors produces internal modules that the legacy Kernel cannot update. That is a limit of that runtime, not of the contract: the development runtime accepts accessor exports as replaceable, which is how a re-exporting entry point is updated there. And the public API of a module is fixed when its artifact is first evaluated, so adding or removing a public export requires loading the module again rather than updating it.

Keep three relationships distinct: internal source imports and evaluation, public module imports, and package/version selection. Processor delegation is a fourth, build-local flow between processors. None automatically supplies another graph's identities or invalidation behavior.

## Artifacts, dependency resolution and watching

[Artifacts](../modules/artifacts/index.ts) turns the conditional outputs of a workspace into files: one artifact and one update per public module and conditions, their source maps, and an [import map](../modules/artifacts/importmap.ts) that resolves the bare public specifiers the artifacts preserve. Its report describes what each artifact is, which build produced it and how its dependencies were resolved, which is the provenance a delivery service or a consumer needs.

Public references are resolved against the workspace by [Dependencies](../modules/artifacts/dependencies.ts), so a package under development satisfies the dependencies of its siblings, and are checked against the declared ranges: an undeclared dependency, an incompatible version and a module the required package does not publish are reported instead of silently resolved elsewhere. A public module of the same package needs no declaration. Whatever the workspace does not provide (the runtime, Node builtins, installed packages) is left to the environment that executes the artifact.

[WatchersService](../modules/watchers/index.ts) starts the filesystem watching the packages subscribe to. It runs in a child process started with the loader of the current process, which imports the service implementation as an ordinary public module, and registers it under a name that the watcher client of each package addresses. Startup is awaited and its failure is observable, so a workspace never silently stops rebuilding. Watching is opt-in: `new Workspace(path, {watcher: true})`.

## Services and reusable library access

Updates of composed modules are delivered by a provisional route of [the HTTP routes](../modules/http/routes/updates/index.ts), `GET /u/<hash>/[<registry>/]<package>@<version>/modules/<subpath>?<options>`, mounted with the compiled-module routes wherever a delivery is given. `<hash>` is the artifact hash that a `build.ended` event of the [development module](development-contract.md) announced, so every update has its own URL and a notification that is no longer current is refused (`409 UPDATE_SUPERSEDED`) instead of being answered with newer code; a module that is not composed at runtime has none (`404 UPDATE_NOT_APPLICABLE`). The rest of the path and the options are read with the codec of the compiled-module contract, but the route is deliberately outside `/m/` and answers its own errors: that contract is a shared specification that does not describe updates, and whether it should is its owner's decision. The development runtime is the client: it subscribes to `/events`, reads `/session` and imports these URLs.

`Delivery` already answers development module requests through the shared artifact-api HTTP adapter. Complete type/style/asset and published release delivery are separate required extensions; see the [CDN contract](cdn-contract.md). CDN uses a distinct retrieval-only adapter and must not compile on a miss.

The local development server owns watcher bootstrap, request defaults, update publication and application bootstrap. An independent CDN consumer owns its storage, caching, authorization, session policy and deployment. Library imports must not implicitly start those services. Preserve public bare references and select runtime/editor resolution consistently. The [development guide](development.md) describes the remaining HTTP, widget, types, style and HMR work.
