# Architecture and bundlers SDK

The [CDN integration contract](cdn-contract.md) distinguishes existing builders and development HTTP delivery from required independent analysis, immutable inventories and published adapter parity. Historical fixture limitations below do not negate current Delivery/Declarations capabilities.

The [Dev Server/File API contract](development-server.md) assigns these services to Packages, including source revisions, external changes and events. Workspace owns central administration and Docker placement/access; project containers validate delegated authorization without owning users/roles. Preserve existing public compatibility; inspector is not a separate product component.

Packages turns package/module specifications into conditional artifacts through collaborating objects. Workspace and Package own discovery and configuration; registered bundler implementations select module behavior; conditionals select platform/environment; processors transform sources into outputs. HTTP and other consumers must obtain those outputs through the same object model.

The implementation includes source collections, delegated processing, ESM assembly, maps, diagnostics and Delivery-backed development integration. Both bundlers produce code, stylesheets and maps: the esbuild packaging path from the imports of its sources, the TypeScript bundler from the CSS, SCSS, Tailwind, Vue and Svelte sources of a module through reusable SDK processors, described in [styles, framework sources and declarations](#styles-framework-sources-and-declarations). This guide describes existing APIs and limitations; [development](development.md) defines the intended service and widget acceptance criteria, and [programming](programming.md) explains authoring conventions.

## Three authoring experiences

For Beyond authoring with TypeScript and module-specific features, `module.json` is the preferred entry point. It declares the module and its compilation configuration without requiring a duplicate hand-authored package exports entry. The package supplies name/version, manifest discovery and bundler registration/default; internal helpers remain private source files.

Current discovery reads `beyond.modules` (or the source publication's `beyond.publication.modules` fallback). A manifest derives its public subpath from its directory (`message` becomes `./message`, root becomes `.`), or supplies `subpath` explicitly. `bundler` selects a registered implementation; otherwise `beyond.bundler` applies. For the current TS bundler, a manifest-only module supplies `entry` relative to its directory, such as `index.ts`; a missing entry is `MODULE_ENTRY_MISSING`. Its ordinary source exports are that module's API, not new public package modules.

Package `exports` is an alternative declaration route associated with standard JavaScript packaging; current Packages also accepts source TS targets there. When both forms declare the same subpath, discovery merges them and checks contradictions; authors do not need to duplicate them. The existing template uses this combined form, which remains supported.

Output representation is a separate contract. The artifacts writer emits versioned module files/maps and an import map. The distribution Layout writes outputs and `beyond-distribution.json`, returning a `beyond.publication` declaration; it does not rewrite the author's `package.json` or automatically generate its exports. Do not promise an unimplemented npm manifest generator or require its output form as duplicated source authoring.

A bundler author exports a `Module` constructor implementing the core module/conditional contract. Producing `ConditionalOutput` directly is supported; reusable SDK processors are optional. There is no mandatory separate packager layer. The older exports bundler illustrates direct output but its narrow target handling is not a complete authoring tutorial.

A processor author exports a `Processor` constructor for use by SDK conditionals. Implement `_spec`, `_settings` and `_build(request, outputs)` as needed, declare every source/configuration dependency, publish diagnostics and avoid stale asynchronous results. The bundler chooses the processors and interprets their results. A package author's module options are not a universal processor configuration schema: each bundler selects what it consumes.

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

[DelegatingProcessors](../modules/sdk/conditional/processor/sources/delegated/processors.ts) finds processors whose `delegates` set includes the receiving processor's name, requires those producers and obtains `outputs.delegated.get(receiver)`. This is processor-to-processor data flow. It is not a public module dependency edge or package release selection. The active TS analyzer and ESM assembler extract public references from emitted internal modules. Delegation does not replace that analysis or package-version resolution.

[ProcessorOutputs](../modules/sdk/conditional/processor/outputs/index.ts) has `ims`, `styles` and `types` collections and delegated collections, one container per build. [OutputsCollection](../modules/sdk/conditional/processor/outputs/collection.ts) exposes `obtain(file: DynamicFile)` and `update(output: ProcessorOutput)`, indexed by relative filename. Each [ProcessorOutput](../modules/sdk/conditional/processor/outputs/output/index.ts) has source, code and issues. Its code object extends ConditionalOutput with an exports Set.

The [ConditionalOutput](../modules/module/output/index.ts) final value API is:

```ts
set(values: { code: string; map: string | object });
code(output?: 'raw-code' | 'sourcemap-inline');
map(format?: 'string' | 'object' | 'base64');
// hash getter: MD5 of raw code, reset by set()
```

It lazily converts map formats and appends inline maps when requested. Its hash covers code, not map content. It does not schedule builds, aggregate diagnostics, persist an artifact, register a URL or install styles. [IssuesOutput](../modules/sdk/conditional/processor/outputs/output/issues/index.ts) accepts `push('errors' | 'warnings', {code, message, position?})`. Per-source issues are separate from the conditional's own diagnostics.

`ESMConditional` reads the three collections of every processor through [Outputs](../modules/sdk/conditional/esm/outputs.ts), processors by name and outputs by file, so the artifact, the stylesheet and the declaration of a module do not depend on the order in which files were discovered or builds completed: `ims` are assembled into the artifact, `styles` are concatenated with their maps into `conditional.styles`, and `types` into `conditional.types`. The esbuild processor instead exposes its own `bundle` result; `Packaged` maps its CSS/map to `conditional.styles`. Both paths therefore end in the same `styles` member, which `Artifacts` writes beside the artifact and `Artifacts.Resources.styles` delivers. Runtime registration, dependency loading, Shadow DOM adoption and CSS replacement are the runtime's and Widgets' responsibilities, described below and in the suite's styles guide.

## Invalidation, validity and cleanup limitations

The following defects of the reusable processor lifecycle were repaired on 2026-09-21 and are exercised by the [styles and SDK validation](../tests/styles-sdk/index.mjs):

| Repair | Where |
| --- | --- |
| An auxiliary file (`tsconfig.json`) is located in the module directory; it was joined twice and never found | [ProcessorFiles](../modules/sdk/conditional/processor/sources/files/index.ts) |
| The input specification is read from a copy, and the default processor projection keeps `excludes` (directories relative to the module) beside `path` and `files` | [ProcessorInputsSpec](../modules/sdk/conditional/processor/sources/inputs/spec.ts), [ConditionalProcessor](../modules/sdk/conditional/processor/index.ts) |
| A processor kept by name but selected under another specifier is destroyed and imported again; a configuration failure destroys every processor instead of throwing | [ConditionalProcessors](../modules/sdk/conditional/processors/base/index.ts) |
| The delegation collector stores the hash it computes and publishes the errors of its delegators; the delegating processors report their own changes | [DelegationCollector](../modules/sdk/conditional/processor/sources/delegated/index.ts) |
| The diagnostics of a conditional include the ones of its processor collection, so a processor that cannot be imported is reported where consumers read; every processor exposes `warnings` | [Conditional](../modules/sdk/conditional/main/index.ts) |
| Conditionals, processors, sources and their children call `super.destroy()` and release what they own; the finder utility's failure to destroy a never-watched collection is contained | The `destroy` members of those classes |

Still as observed: the [optional resolver](../modules/sdk/conditional/processors/resolver/index.ts) reads `bundler.settings.values.processors`, while ProcessorSettings reads `bundler.settings.processors`; ConditionalSpec exposes `valid` as a method. ModuleResolver awaits the selected bundler before instantiating a module and replaces the instance when the implementation behind the same name changes.

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

The [TS Processor](../modules/bundlers/ts/processors/ts/index.ts) extends ConditionalProcessor and configures `.ts`/`.tsx` inputs plus a JSON `tsconfig.json` auxiliary file. `_build` obtains `outputs.ims.obtain(input)` then calls `Transpiler.process` and `Analyzer.process`; `.d.ts` files do not produce runtime code.

[Transpiler](../modules/bundlers/ts/processors/ts/transpiler.ts) uses TypeScript `transpileModule` (CommonJS module output, ES2022 target, per-file source maps, no type checking); diagnostics become `TRANSPILE_ERROR` issues with positions. CommonJS with assignment-style exports is required by the runtime internal-module contract: getter-defined exports (SWC's CommonJS output) cannot be re-created by the installed Kernel on a patch. The [analyzer](../modules/bundlers/ts/processors/ts/analyzer.ts) reads the emitted body with `cjs-module-lexer` to record the exported names, `export *` re-exports and bare dependencies. The loaded tsconfig is not read by this transformation; it drives the `types` conditional. The magic-comment export extractor was removed: target packages expose their public API through the entry point's ordinary exports.

The SDK [ESM assembly](../modules/sdk/conditional/esm/index.ts) emits the executable artifact through its [assembler](../modules/sdk/conditional/esm/assembler.ts): internal modules identified by `./relative/path` with 32-bit content hashes, sorted for stable output; bare imports preserved and registered in the runtime package; the exports descriptor and `export let` live bindings of the entry internal module; `__beyond_pkg`/`hmr` handles; `initialise(ims)` for the artifact and `update(ims)` for the patch. Processor issues are aggregated into the conditional diagnostics and no output is exposed while errors exist.

To author another bundler against this design, expose a public Module, register its specifier under a package alias, choose conditionals, project their spec, then either configure SDK Processors or produce a core ConditionalOutput directly. Reuse these signatures and explicitly define source/options/error handling. The current ESMConditional assembles the TS path; a different processor still needs compatible outputs and its own validation.

## Styles, framework sources and declarations

The [TypeScript bundler](../modules/bundlers/ts/module/index.ts) configures four processors for every executable conditional, each of which compiles only the inputs of its extensions and loads its compiler on first use, so a module without a `.vue` file never loads Vue:

| Processor | Inputs | Produces |
| --- | --- | --- |
| [ts](../modules/bundlers/ts/processors/ts/index.ts) | `.ts`, `.tsx` | One internal module per file (CommonJS creator body), with its map, exports and dependencies. Its [Transpiler](../modules/bundlers/ts/processors/ts/transpiler.ts) and [Analyzer](../modules/bundlers/ts/processors/ts/analyzer.ts) are public, so a framework processor transforms the code it generates the same way. |
| [styles](../modules/bundlers/ts/processors/styles/index.ts) | `.css`, `.scss`, `.sass` | One style output per non-partial source, compiled by Sass 1.104 (plain CSS is passed through with its relative `@import`s resolved), or by Tailwind 4.3 when the source imports it. Partials (`_name.scss`) produce nothing of their own. |
| [vue](../modules/bundlers/ts/processors/vue/index.ts) | `.vue` | For `view.vue`: the internal modules `./view.script` (both script blocks, compiled by Vue 3.5's SFC compiler and transpiled), `./view.render` (the template, compiled with the binding metadata of the script; the server render function on `node`) and `./view` (the facade, what `import View from './view.vue'` resolves to), plus one style output per `<style>` block, scoped or not. |
| [svelte](../modules/bundlers/ts/processors/svelte/index.ts) | `.svelte` | For `view.svelte`: the internal module `./view`, compiled by Svelte 5.57 for the client on browser platforms and for the server on `node`, with `css: 'external'`, and its style output. TypeScript in `<script lang="ts">` is handled by the Svelte compiler. |

Errors keep the positions of the authored file (`STYLE_ERROR`, `TAILWIND_ERROR`, `VUE_PARSE_ERROR`, `VUE_SCRIPT_ERROR`, `VUE_TEMPLATE_ERROR`, `VUE_STYLE_ERROR`, `SVELTE_ERROR`), and a module with an invalid stylesheet or component is not published. The stylesheets of a module are its style sources, not imports of its code: `import './x.css'` belongs to the esbuild packaging mode, whose bundler follows the imports of the entry point.

A stylesheet that imports Tailwind is compiled with a compiler created for that build and never retained, because a retained compiler accumulates candidates and cannot forget a class that no source uses any more. Only the sources the module manifest declares are scanned (`"tailwind": { "sources": ["view.tsx", "parts"] }`, relative to the module directory; a path outside it is `TAILWIND_SOURCE_OUTSIDE_MODULE`), automatic detection is turned off (`source(none)`), and a manifest that declares no sources gets the theme and its own rules and no utility. `tailwindcss` and the stylesheets it imports resolve from the package of the module first, then from the installation that runs Packages; the Tailwind stylesheet is delivered with a map. Every file a compilation reads besides its inputs (a partial, a theme elsewhere in the package, the scanned sources, a plugin) is watched by the processor as a discovered dependency ([Dependencies](../modules/bundlers/ts/processors/styles/dependencies.ts)) until a later build no longer reads it; files outside the package (an installed stylesheet) are read and not watched.

Every browser platform of a module of this bundler also has a production conditional, `web/production` ([Module](../modules/bundlers/ts/module/index.ts)): the same composition, minified by the `esbuild` installed with Packages ([Minifier](../modules/sdk/conditional/esm/minifier.ts), loaded on first use), with a minified stylesheet and neither a source map nor an update patch. It is what a request for `env=production&min=true` is answered with, so a page on another origin can load the production output of a widget, its stylesheets and the runtime from the compiled-module routes without the development connection; the `dependencies` and `boundaries` cases of the command line's web acceptance execute that. The internal modules, their hashes, the runtime and the widget registration are those of the development conditional, so the production output behaves as the development one did. Nothing here is a published distribution: the CDN prepares its own outputs from sources or from a distribution, which the `ts` bundler does not produce yet.

A manifest can give each conditional its own values under `conditionals`, keyed by conditional (`web`, `node`, `web/production`), merged over the values of the module ([Spec](../modules/bundlers/ts/module/spec.ts)): one public module can have one entry point for browsers and another for Node, each excluding the sources of the other side, which is how the Widgets adapters implement one public identity per platform. A manifest can declare a widget under `widget` ([Widget](../modules/sdk/conditional/esm/widget.ts)): the element name and observed attributes, optional `is`, `route`, `layout` and `render` modes. The artifact then imports `@beyond-js/widgets/render` and registers the widget before its internal modules are evaluated, and its bundle is created with `type: "widget"`; the entry point must export `Controller` (`WIDGET_CONTROLLER_MISSING`). A widget also learns whether its package publishes a `./global` module, which is the shared stylesheet its root adopts first. A module whose entry point is a stylesheet (`"entry": "global.css"`, or an `exports` target ending in `.css`) publishes no code: its artifact is an empty public module whose stylesheet is what consumers link.

The artifact tells the runtime what to register: the bundle specification carries `styles: true` when the module produced a stylesheet, which the runtime registers under the versioned identity of the module with the address derived from the address of the module (`…/modules/<subpath>` becomes `…/styles/<subpath>` under the compiled-module contract; a file artifact has its stylesheet beside it). `IESMArtifact` and the delivery report `styles` (the hash of the stylesheet, which changes with the stylesheet alone) and `widget` (the registration).

Composed modules whose bundler selects a runtime other than the Kernel and whose sources import a Kernel family are assembled against that runtime ([Compatibility](../modules/sdk/conditional/esm/compatibility.ts)): `@beyond-js/kernel/bundle`, `/core`, `/styles` and `/routing` are imported from `<runtime package>/bundle`, `/core`, `/styles` and `/routing`, while the internal modules keep requiring the specifiers their sources wrote, registered under those names. Every public module of the runtime package is classified as `runtime` by [Dependencies](../modules/artifacts/dependencies.ts) and is never version-checked. This is how the existing Widgets sources run on the development runtime unchanged; the routing, texts and transversals families are not provided and are imported as written.

The `types` conditional ([Types](../modules/bundlers/ts/module/types.ts)) is added to every module of this bundler beside its declared platforms. Its [processor](../modules/bundlers/ts/processors/tsc/index.ts) checks the `.ts`/`.tsx` sources of the module as one program (options from the module's `tsconfig.json`, declarations only, bundler resolution, type roots from the module upwards and from the installation that runs Packages), with the declaration of every workspace module the sources import held in memory as an ambient module (awaited from that module's own `types` conditional for a bounded time, so two modules whose types depend on each other are reported instead of deadlocking) and a synthesized `any` default export for each framework component. Semantic diagnostics are reported on the files of the module with their positions (`TS2322`, …); diagnostics of installed declarations are their owners'. The output is the declaration of the public module ([Declaration](../modules/bundlers/ts/processors/tsc/declaration.ts)): each source file as an ambient module named `<vspecifier>/~/<file>`, relative references rewritten to those names, bare imports kept, and the public module re-exporting its entry point. `Artifacts` with `{ platform: 'types' }` writes it as `<module>.types.d.ts`. Delivery and the development service do not serve declarations: an editor consumes the written files, which is the explicit disk form of the resolution the suite's TypeScript guide describes. The declaration of a module with one entry per platform follows the entry of its first declared platform (`conditionals.web.entry` for the Widgets adapters), and the declarations of the workspace modules the sources import are read transitively, so a class inherited two modules away resolves. Every diagnostic of the processors keeps `file` (absolute, internal) and `position` beside its message; the development contract locates them inside the served root (`file`, `range`, `revision`) and serves the declaration of a module at `GET /declarations/<specifier>` ([development contract](development-contract.md)); the compiled-module routes keep `{ code, message }`.

Three details of the same work matter to authors and are executed by the web acceptance of the command line. A stylesheet export of a package (`"exports": { "./global": "./global.css" }`) declares a public module with no code, compiled by the default bundler from that entry and what it imports alone ([Declarations](../modules/package/main/modules/declarations.ts)): the shared sheet of a package, which every widget of the package adopts first. A package whose `beyond.modules` names a subdirectory locates each module from the package (`Manifest.path`, [manifest](../modules/package/main/modules/manifests/manifest/index.ts)), which is how the Widgets package and the adapters, with `"modules": "./modules"`, compile; an unwatched package (the ones the toolchain supplies) compiles the same way. The facade of a Vue component requires its generated `.script` and `.render` siblings relatively and carries the hash of the component source, so a component in a subdirectory resolves and an edit of its template alone reaches the mounted view.

The [styles and SDK validation](../tests/styles-sdk/index.mjs) executes all of this on a temporary copy of its fixture under BEE Node with the real watchers service: SCSS with a partial and CSS concatenated in file order with a map, Tailwind from declared sources with a theme outside the module, a Vue component with `<script setup lang="ts">`, a scoped and a global style block, a Svelte 5 component, a widget registration, per-conditional entries, public declarations with a cross-module type import and a positioned semantic error, the Kernel-family mapping, and watched edits: a class added to and removed from a Tailwind source, a partial and a theme invalidating only their dependents, an invalid stylesheet with its position and last-good recovery, and the deletion of the last stylesheet of a module. Run it with `BEE_URL=http://localhost:1112 WATCHERS_URL=http://localhost:1120 node --import "$BEE_NODE_DIR/register.mjs" tests/styles-sdk/index.mjs`; expected `14/14 steps passed`.

## esbuild bundler: the packaging mode (trial)

The [esbuild Module](../modules/bundlers/esbuild/module/index.ts) compiles a public module in the esbuild packaging mode, the counterpart of the runtime composition the TypeScript bundler produces. A module selects it like any bundler, through `bundler` in its manifest or the package default, so two modules of one package can use different modes and keep the same public address. It enumerates each declared platform twice: for development use and as a `platform/production` conditional that is minified.

Its [conditional](../modules/bundlers/esbuild/module/packaged.ts) extends the SDK Conditional with one processor, so the files of the module directory are watched inputs like those of any other bundler. The [bundle processor](../modules/bundlers/esbuild/processors/bundle/index.ts) bundles the entry point into one native ES module. Its [boundary](../modules/bundlers/esbuild/processors/bundle/boundary.ts) keeps every bare specifier as a public reference, bundles relative files and package-private `#imports`, and turns a relative import of another public entry of the same package into a reference to that module, so two artifacts never hold separate copies of one state. The conditional exposes `output` and an `artifact` with `composition: 'packaged'`, no internal modules, the bundled `inputs`, the public `stars` it re-exports and the `compiler`; it has no `patch`. [Artifacts](../modules/artifacts/index.ts) and [Delivery](../modules/artifacts/delivery.ts) accept a conditional without a patch and report the composition of every artifact.

The [compiler](../modules/bundlers/esbuild/processors/bundle/compiler.ts) is selected explicitly in the bundler's package settings (`processors.bundle.compiler`). The value is an installed package name or a `file:` URL, which the running loader resolves; a path starting with `./` or `../`, resolved against the root of the package that declares it; or `env:NAME`, the value of that environment variable, which must be an absolute path, a `file:` URL or a package name, so one manifest serves checkouts placed differently. There is no default and no fallback: a module that selects none, or names a variable that is not set, reports `COMPILER_NOT_SELECTED`. The artifact reports the value as declared, the resolved version and location, a capability probe that tells the Beyond fork from upstream, and the fork's provenance when present. This repository's own `esbuild` dependency belongs to the exports bundler and is not what a packaged module is built with unless it is selected.

This is a trial validated by [its own run](../tests/esbuild-packaging/README.md) on Node. It produces and rebuilds packaged artifacts; it does not deliver or apply updates to a running consumer, and it has no types or framework source adapters. Since the CDN v1 work its processor also emits the stylesheet a module imports with its map, keeps static files as package-relative asset references and turns a bare `require()` into a native import of the same specifier; ordinary npm and CommonJS inputs and the published-package closure are handled by the separate [analysis, generation and publication modules](cdn-outputs.md), not by this bundler. It compiles one public module at a time and nothing else: Beyond divides code by public module, so neither this bundler nor anything built on it splits a module into private chunks or compiles several modules together. The development runtime (`local-2026`) is compiled with it, which [its validation](../tests/unified-runtime/README.md) executes.

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

`Delivery` already answers development module requests through the shared artifact-api HTTP adapter. Semantic types and SDK/runtime stylesheet integration remain separate work; existing esbuild style/asset delivery and published-output paths must be preserved; see the [CDN contract](cdn-contract.md). CDN uses a distinct retrieval-only adapter and must not compile on a miss.

The local development server owns watcher bootstrap, request defaults, update publication and application bootstrap. An independent CDN consumer owns its storage, caching, authorization, session policy and deployment. Library imports must not implicitly start those services. Preserve public bare references and select runtime/editor resolution consistently. The [development guide](development.md) describes the remaining HTTP, widget, types, style and HMR work.
