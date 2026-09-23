# Packages contracts required by CDN v1

Packages is the reusable Beyond compiler/resolver for the development service and CDN. CDN owns release persistence, authorization, orchestration and read-only artifact delivery. These are implementation requirements, not proof of a completed CDN integration. Read [architecture](architecture.md), [development service](service.md) and the [source evidence](reviews/2026-09-19-cdn-readiness.md).

## Existing reusable capabilities

`Artifacts.build()` compiles workspace public modules, writes ESM/maps and applicable patches, and returns an import map and provenance metadata. `Delivery.published()` inventories declared public modules; `Delivery.module()` compiles one selected module for conditions without writing files. Development `Builds` correlates results to source revisions. These are real source capabilities, not a complete immutable CDN inventory or npm distribution assembler.

`Declarations` combines source exports with matching module manifests, applies the package default bundler and diagnoses contradictions. Do not restore the older claim that exports always discard same-subpath manifests. The type name does not mean semantic TypeScript declaration generation.

The esbuild packaging processor preserves public bare references, bundles private source internals and collects code/maps and input metadata. External package classification in `artifacts/dependencies.ts` is separate from the registry-backed package/version graph. Ordinary npm compatibility, complete styles/assets delivery and an independently executable compiled distribution of Packages remain unproven.

## Required three-stage boundary

1. Resolve a registered application's package/version graph using provider metadata, credentials, exact entries and targets. Freeze origins/releases/integrity, peers and conditional policy. Do not analyze code here; providers without metadata may require manifest retrieval.
2. Independently download **all missing packages of that pinned graph**, verify archives and retain durable inputs. Then analyze from application entries to identify reachable public modules, lazy imports, styles as modules and declared static assets. Persist an inventory of compatible existing versus missing outputs. Do not progressively fetch only packages encountered during module generation; do not generate all modules in all downloaded packages. Analysis must be callable separately from generation; current compilation metadata may support it but does not establish this capability.
3. Generate only inventory outputs missing compatible authorized artifacts. Return real outputs, diagnostics and provenance for CDN to persist and serve. CDN marks readiness only after the required serving closure is durable/retrievable.

Unknown dynamic imports require declarations or diagnostics. Preserve the distinction between package, public-module and internal-source graphs. Select native ESM/import-map or compatible SystemJS/custom-loader outputs explicitly; runtime/Widgets behavior and browser/backend conditions need corresponding fixtures.

A CDN GET/miss must never invoke compilation. Keep development's compile-on-request behavior separate from published retrieval; reuse generation APIs only inside explicit jobs. CDN also supplies external dependencies to local CLI and cloud Workspace; Packages owns edited-source serving and HMR. Offline CLI artifact caching is outside CDN v1.

## Resolver and provider work required for integration

Repair cycle/visited handling, per-occurrence identity, error-aware recursive completion and bounded invalidation. Resolve peers in their context, exclude inappropriate transitive development dependencies, define optional/build dependency policy, apply overrides and reuse pinned locks. Selection must be reproducible and independent of traversal order where constraints permit. Unsupported source kinds must fail explicitly; supported Git inputs must pin commits, aliases must preserve target identity and URL inputs require content integrity.

Normalize registry base URL, host, port and path consistently; document and test settings precedence. Keep defaults instance-local, await settings/cache operations, and avoid concurrent duplicate fetch/write races. Fetch the actual release tarball metadata and verify integrity instead of synthesizing an unversioned URL. Bound archive size and extracted content. Private credentials and cache records require permission/tenant context; never mark every download public. No credential may reach output metadata, logs, URLs or browser configuration.

Public source reuse is keyed by origin/release/integrity. Artifact compatibility covers actual source inputs, resolution, compiler/bundler version/configuration, conditions and output kind. Version alone is insufficient. CDN owns reference-aware retention for active/rollback/in-flight releases; mutable `Files.prune()` is not immutable shared storage GC.

## Generation, publication and diagnostics

Support npm-published Beyond sources and precompiled distributions plus ordinary npm dependencies. Specify an unambiguous versioned source/distribution discriminator rather than extension heuristics alone. Extend the limited exports adapter deliberately; React compilation and renderer peer identity require evidence. Existing artifact emission must not be denied, but it does not prove a complete npm manifest/exports/resources/declarations/archive assembler or automatic `npm publish`.

Return stylesheet modules and declared assets with their relationships, media types, digests and stable references; collecting `.css` inputs without emitting CSS is insufficient. Output assembly must preserve public module isolation and bare APIs, never make arbitrary internal files public.

Implement real semantic TypeScript Diagnostics through bundlers for premium CDN jobs. Essential build failures remain available for free jobs. Packages supplies the capability and structured diagnostics; CDN enforces entitlements and accounts for its cost. Neither esbuild transpilation nor a diagnostic container establishes semantic checking.

Workers must be safely interruptible at CDN hard deadlines, with verified completed outputs reusable on retry. Do not claim esbuild pause/resume. Packages supplies bounded generation units and provenance; CDN owns fair scheduling, isolated workers, recovery, usage/credit and stage events. Preparation has separate limits from generation turns.

Backend targets produce a delivery closure usable by an external execution environment; CDN v1 does not launch or administer backend hosts. Engine remains the implementation bootstrap until an independent Packages distribution is actually produced and validated. Do not substitute Engine target compilation for Packages acceptance.

## Acceptance required before CDN integration is complete

| Area | Evidence |
| --- | --- |
| Graph | Cycle/diamond/repeated/versioned nodes terminate correctly; errors prevent valid closure; peer contexts, optional/build policy, overrides and locks are reproducible. |
| Providers | Public/private registries with scoped auth, custom paths/ports and competing settings resolve correctly; parallel tenants cannot share credentials or private records; no secret-bearing diagnostics. |
| Fetch | All pinned missing packages fetched once with integrity and extraction limits; corruption/outage is explicit; retained inputs work after origin loss. |
| Analysis | Independently inspect a durable reachable inventory before generation; lazy modules/style modules/declared logo included, unreachable modules excluded, unknown dynamic imports diagnosed. |
| Outputs | Both npm publication forms and ordinary npm/React fixture work; public boundaries preserved; selected browser/backend loader formats, maps, CSS and asset references are correct. |
| Diagnostics | Semantic error missed by transpilation is reported by premium capability; essential errors remain available independent of entitlement. |
| Reuse/recovery | Compiler/config/target/resolution changes invalidate correctly; worker interruption preserves only verified completed artifacts; retries do not duplicate outputs or measurements. |
| Consumer separation | Development may compile on demand; CDN retrieval never does. A complete backend artifact closure reports no process launch. |

These checks are part of the CDN implementation assignment. Exact public API additions and metadata versions must be specified with fixtures before wiring consumers. Routine configurable defaults may be selected with rationale; commercial pricing and product authority must not be invented.

## Implementation status

The capabilities below were added for this contract on 2026-09-19. Each guide states its public API, its engineering defaults, the exact validation command and its remaining limits. The results are executed Packages validations under BEE Node with a bootstrap Engine; they are not CDN acceptance gates, which are judged on the integrated system.

| Public module | Guide | Executed validation |
| --- | --- | --- |
| `@beyond-js/packages/resolution`, `@beyond-js/packages/sources`, with the graph, provider, settings, cache and source-parsing repairs | [Resolution and sources](cdn-resolution.md) | `tests/cdn-resolution` 33 steps, `tests/cdn-sources` 16 steps, against in-test public and private registries |
| `@beyond-js/packages/analysis`, `@beyond-js/packages/generation`, `@beyond-js/packages/publication`, stylesheet and asset emission, development delivery of `/styles/` and `/assets/` | [Analysis, generation and publication forms](cdn-outputs.md) | `tests/cdn-analysis` 12 steps, `tests/cdn-outputs` 21 steps, including real React 19 units sharing one React instance in `esm` and `System.register` form, outputs that are byte-identical whatever directory a package was extracted into, and the headers of every contract error |
| `@beyond-js/packages/diagnostics` | [Semantic TypeScript Diagnostics](cdn-diagnostics.md) | `tests/cdn-diagnostics` 24 steps |

The earlier validations were rerun against these changes together: stage-1 21, esbuild packaging 8, unified runtime 6 and 7, CLI baseline 22 and development 15 steps. The [source audit](reviews/2026-09-19-cdn-readiness.md) is retained as the record of the state before this work; its findings are answered in the guides above, which also list what was repaired in source only and could not be executed (the database settings loader and the local-install downloader, which depend on legacy persistence loading). Browser execution, real registries, a real SystemJS loader and an Engine-independent compiled distribution of Packages remain unproven.

## Shared consumer API, separate HTTP adapters

The existing public contract is `@beyond-js/artifact-api`, owned by the independent artifact-api repository. Reuse its module identity/URL and option codec, error vocabulary and conformance fixtures. Packages Dev Server serves development through its own adapter over `Delivery`; CDN implements its own HTTP adapter for retained published outputs. Do not start Packages Dev Server inside CDN or turn published GET/miss into generation.

Keep consumer-facing module/output/resolution/error semantics compatible where applicable. Define capability differences explicitly: development currently supports a narrower output set, source changes and no-store policy; published delivery has immutable releases and access-aware caching. Extend/version the shared contract when styles/assets, resolution or missing-artifact semantics require it; do not invent a competing CDN grammar or claim today's contract already covers all v1 outputs.

Run shared request/response conformance and paired consumer fixtures against both adapters: public subpaths and exact versions, options, supported output bytes/resolution, structured errors and ETags/conditional requests. Assert unsupported capabilities explicitly and test intentional cache/lifecycle differences separately. CDN misses must remain retrieval-only. Editing, File API, `/session`, attachment, revision events and HMR are development-specific and need not become CDN endpoints.

Against `@beyond-js/artifact-api` 0.3.0 the development adapter ([HTTP routes](../modules/http/routes/index.ts)) serves `format=esm` and `format=system` (converted by `SystemFormat`, updates included), `/resolution.json` and `/importmap.json` computed from the workspace, installed packages under the registry their lockfile recorded (`/m/<registry id>/…`, npm unprefixed, Git and archive installations `SOURCE_UNSUPPORTED`), the cross-origin headers of the contract on every answer, and `NOT_FOUND` and `INTERNAL` as its service-level codes. The conformance of the contract, its documents and `format=system` pass against it locally ([the development tests](../tests/development/README.md)); CDN runs the same conformance against its adapter, and its acceptance compares one relative request on the two origins (gate `V1-21`). Local results are not hosted parity.

The same module/output request must use the **same relative URL path and query**, including module/output identity, on development and CDN. A consumer changes only the base origin (host/domain and, where required locally, scheme/port). This is request/response/error compatibility, not merely similar TypeScript interfaces. `@beyond-js/artifact-api` owns the shared route/schema; extend it coherently if necessary. Revision, immutable caching, authorization and miss policy differences must not invent incompatible module URLs. Acceptance parameterizes one client and one relative request with the two base origins; runtime parity remains unproven. This requirement authorizes no broad architectural migration.
