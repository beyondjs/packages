# Development and acceptance

The [Dev Server/File API contract](development-server.md) assigns these services to Packages, including source revisions, external changes and events. Workspace owns central administration and Docker placement/access; project containers validate delegated authorization without owning users/roles. Preserve existing public compatibility; inspector is not a separate product component.

Beyond is written in Beyond. Packages is the new Beyond packaging implementation, itself authored as Beyond public modules and internal components. Engine is the existing compiler generation used to compile and serve this implementation; Packages is responsible for compiling and serving its target applications.

Read [programming conventions](programming.md) before extending module structure and [architecture and SDK](architecture.md) for discovery, bundlers, conditionals, processors and outputs. All required explanations are contained in this repository. Engine, BEE Node, Kernel, Local, Widgets and CDN are independent components referenced here by their responsibilities, without requiring sibling checkout paths.

## Execution model and prerequisites

```text
Engine compiles Packages implementation modules as ECMAScript
  → modern BEE Node loads them through Node custom hooks
    → Node executes Packages and its development service
      → Packages discovers, compiles and serves the target application
        → browser runtime and widgets consume its artifacts and updates
```

Engine may remain running throughout development. Acceptance depends on which implementation produces the target artifacts: Engine-produced Packages implementation is expected; an Engine-produced target app does not demonstrate Packages compilation.

The selected Node loader is modern BEE Node, which uses Node custom hooks and an HTTP loading worker. The existing [server fixture](../tests/test-server/index.js) and older bundler scripts use legacy `@beyond-js/bee` and global `bimport`; they are not the new bootstrap recipe. Modern BEE Node does not automatically supply legacy `bimport`, `brequire` or HMR. The [bundler importer](../modules/package/main/bundlers/importer.ts) and [processor importer](../modules/sdk/conditional/processors/base/importer.ts) load implementations with native `import()` (Engine preserves dynamic imports inside internal modules, and BEE Node resolves the public specifier); the external API-server startup still retains legacy assumptions. The [stage-1 validation](../tests/stage-1/README.md) is the current executed reference for discovery, compilation, artifacts and watched regeneration.

The [manifest](../package.json) declares implementation bundle ports 1110, 1111 and 1112; `node-esm` selects ESM and disables development tools for that distribution. [beyond.json](../beyond.json) points to this package manifest. These ports serve the implementation through Engine, not a completed target dev-server API. The manifest has no npm start/test scripts or directly executable Node root export. Per-module tsconfig files do not define a single standalone tsc build.

Use a Node version supporting the selected BEE Node loader's `registerHooks` contract, an Engine implementation endpoint, and installed dependencies from this manifest. Configure independent loader/compiler locations and endpoints explicitly; no fixed sibling directory layout is part of Packages' public API. [The ESM hello assertion](../tests/hello/index.mjs) checks loader access to compiled implementation modules, not target compilation. Do not extrapolate it into HTTP startup or HMR readiness.

## Public modules and configuration

Packages uses two configuration layers:

| Layer | Source and interpretation |
| --- | --- |
| Author Packages itself with Engine | Root package uses top-level `modules.path`; each module manifest supplies its public identity and bundler. `modules/http/start/module.json` publishes `http/server`, not a path mechanically derived from its folder. |
| Declare target public modules | `package.json` `exports` entries pointing to source files are the entry points of Beyond public modules: their ordinary exports and re-exports are the public API. [Manifest finder](../modules/package/main/modules/manifests/finder.ts) reads `beyond.modules`; a `module.json` adds its specification (platforms, processor options) to the entry of the same subpath and can select the bundler; `beyond.bundler` is the package default bundler. [types](../modules/types/package/index.ts) describe that structure. Older fixtures use top-level modules and require an explicit compatibility choice. |
| Register target bundlers | [Bundlers](../modules/package/main/bundlers/index.ts) maps aliases to public implementation specifiers/settings. The importer expects a public `Module` constructor. |
| Select a target module | [Modules](../modules/package/main/modules/index.ts) combines package exports and discovered manifests into one declaration per subpath, with conflict diagnostics (`MODULE_DUPLICATED`, `MODULE_ENTRY_CONFLICT`, `MODULE_ENTRY_INVALID`); [ModuleSpec](../modules/module/spec/index.ts) carries subpath, path, entry and bundler; the [resolver](../modules/package/main/modules/resolver.ts) waits for the selected bundler implementation before instantiating its `Module`. |

Preserving top-level module discovery as an explicit fallback is one compatibility option; migrating target fixtures is another. Neither is implied by copying the bootstrap manifest into a target. Define precedence and conflict diagnostics while preserving the working bootstrap and public identities. Await the selected bundler itself before using its constructor; registry readiness alone does not establish that readiness.

The architecture has three distinct graphs: package/version selection, public module dependencies, and internal source/evaluation relationships. For example, `@suite/shared/message` is a public module of a package; its relative source imports are internal. Keep public bare specifiers in output and resolve them to selected versions/conditions at runtime. Do not flatten the shared module into an application or rewrite the authoring import into a relative path as a substitute for resolution.

## Service integration and current limitations

[HTTP startup](../modules/http/start/index.ts) constructs external api-server and calls start without returning ready/error/stop. [Routes](../modules/http/routes/index.ts) registers the root and module handlers; info/dependency setup is commented. Its schema finder depends on an ancestor directory named `packages`, which must become an explicit resource location for independent consumers.

[Module routes](../modules/http/routes/modules/index.ts) parse options and set headers/ETags, but `buildBundle` returns fixed JavaScript. There is no wired request → workspace/package → module → conditional → actual artifact path. Map/DTS/CSS headers do not prove those outputs exist or have registered routes. Current options default to production/minification, so development behavior must be explicit. Validate scoped and slash-containing identities, selected conditions, map isolation, missing outputs and compilation diagnostics.

The proposed shared artifact service should accept explicit workspace/package context, module subpath and conditions, return actual selected outputs/diagnostics and own its lifecycle. No complete high-level service method with that contract is currently implemented. Build on the public Package/Module/ConditionalOutput model rather than inventing an unrelated static-file server. The local HTTP adapter and an independent CDN can consume this service; CDN storage, authorization, cache/session policy and deployment remain outside library import side effects.

[Package](../modules/package/main/index.ts) creates a watcher only when requested, while [Workspace](../modules/workspace/index.ts) constructs packages without the option. [PackageController](../modules/package/main/controller/index.ts) does not install change coordination. Manifest discovery does not pass its optional watcher, although processor input finders consume the package watcher. The watcher client talks to a named service, so it requires a service bootstrap or explicit adapter. Package destroys an optional watcher without a guard, and Workspace clears its collection before its destruction iteration; cleanup needs repair when exposing stop.

The [ESM assembly](../modules/sdk/conditional/esm/index.ts) produces the executable public artifact: bare public imports, the runtime package registration, CommonJS internal-module creators with content hashes, the exports descriptor with live public bindings, the runtime handles and initialisation; a patch variant addresses the loaded package with `update`. The [artifacts module](../modules/artifacts/index.ts) writes artifacts, patches, source maps and an import map, and resolves workspace dependencies with version checks. HTTP delivery of these outputs is the [development service](service.md), which answers the compiled-module contract from the same conditional outputs.

## Runtime, widgets, styles and types

The integrated runtime must preserve Kernel's production-needed module composition, imports/exports and style behavior while joining the development capabilities previously split across Kernel and Local. It must accept configured local or cloud service endpoints. Its final public name, packaging boundary, API and migration remain to be defined; those open details do not remove runtime integration from the functional-app deliverable.

A compatible emitted patch addresses an existing runtime package, compares internal hashes, replaces changed creators, updates export bindings and notifies consumers. Native ESM loading does not supply that state transition by itself. Existing class instances, captured values and resource ownership also require explicit consumer/state behavior; do not promise universal replacement or rollback from an import alone.

Widgets require compatible registration/controller metadata, runtime exports, mounting and refresh behavior. JavaScript artifact delivery therefore must be completed together with the selected widget consumer contract. A first fixture can use a deliberately selected framework adapter and runtime version; published versions do not establish compatibility with a new integrated runtime.

Modular styles require compiler output, a stable public style identity, independent delivery, dependency tracking, shadow-root adoption and update/cleanup. Application/global styles have their own identity and update path. Static hardcoded CSS does not prove this pipeline.

Public declarations and editor resolution must agree with runtime package/version/module/condition selection. Type output containers exist, but active declaration emission and editor integration are incomplete. Generate and serve declarations from public API, propagate missing/available changes and verify real diagnostics/completion. A paths override or source-relative import rewrite is not the intended public-module resolution system.

## Dev Server, legacy inspector capabilities and HMR

Packages needs a development notification service connected to watcher invalidation and actual selected artifacts. It must identify workspace/package, public module, conditions, language and output kind; publish successful revisions or explicit failures; and coordinate ordering/reconnect reconciliation with the runtime. Packages Dev Server owns notification/delivery context; inspector is no longer an independent product component. Preserve public compatibility and capabilities until explicit migration; runtime owns update application.

The active HTTP service does not implement that publisher. Retained SDK HMR code is implementation reference, not a wired update loop. HMR of the service's own route implementation is different from target application HMR. A successful import/HTTP response also is insufficient if no runtime update occurred.

Keep focused objects for workspace/package state, compilation, artifact delivery and update coordination, with a transport adapter on top. Packages owns required File API/source editing and development control; Workspace owns frontend and central users/teams/roles/resources/environment administration. Evaluate legacy adapters by actual consumers rather than copying every old method. Completing the widget dev loop does not require deploying the CDN or building a full Workspace UI.

## Acceptance criteria

The functional testbed must contain an application with real widgets and a separately compiled shared public module. Exact fixture directories, available ports and initial adapter versions are implementation choices; preserve their selected identities consistently.

The [first-stage validation](../tests/stage-1/README.md) covers the first rows of this matrix for a Node target, and reports the exact behavior it observed for each one.

| Gate | Required behavior |
| --- | --- |
| Implementation bootstrap | Modern BEE Node executes Engine-produced Packages implementation; complete service startup exposes readiness, failure and stop. |
| Discovery/readiness | Resolve actual target modules and selected bundler constructors, including delayed readiness and invalid/conflicting manifests. |
| Executable output | Parse and execute source-derived public artifacts with real identities, exports and preserved bare dependencies. |
| Independent package | Resolve app → shared using selected source/version rules; missing and incompatible dependencies report errors. |
| HTTP artifacts | Bytes come from the selected Packages conditional; source edits change output and cache identity; unsupported outputs fail clearly. |
| Browser/widget | Real mount/render/unmount and runtime registration work from Packages target artifacts, with visible source-derived content. |
| Styles | Compiled modular CSS is adopted in the widget shadow root; application/global styles and update cleanup work. |
| Types/editor | Public declarations and editor diagnostics/completion resolve the same module/version/conditions. |
| Watch/rebuild | File changes invalidate and rebuild relevant outputs, preserve unrelated output and clean up on stop. Reload-only behavior is labelled as such. |
| HMR | JS and CSS update without full reload, with explicit retained-state behavior, errors/recovery, ordering and reconnect handling. Browser and Node update claims are tested separately. |
| Independent reuse | The artifact service can be consumed outside this repository without fixed folder names or implicit server startup. CDN deployment is a separate milestone. |

A widget render is the first visible milestone, not completion of types/styles/HMR. Record the actual fixture, selected compatibility contract, compiler/artifact provenance and observed outcome for each gate. The existing legacy diagnostic scripts log errors and outputs; logging or a fulfilled ready Promise is not a substitute for assertions on the selected public contract.

## Local and cloud development service

The same Packages-based development service supports local Beyond installations and cloud Workspace sessions. Its broader source/configuration/build/control and realtime surface is described as the Development API; inspector remains the legacy name and protocol reference. The exact transports and public API remain to implement. Runtime resolution selects developing packages from this service without rewriting bare public references; CDN remains the delivery path for published versions. Repository working copies, revisions and session ownership belong to the development host, not implicitly to Packages’ filesystem Workspace class.
