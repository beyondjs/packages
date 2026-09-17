# Developing the new Beyond implementation

Packages is the newer generation of Beyond, implemented with Beyond modules. Legacy Engine is the existing generation, currently needed to compile and serve this implementation and to explain established behavior such as HMR. They are not primarily two alternative dev-server products.

Read [AGENTS.md](../AGENTS.md). In the suite checkout, the canonical [implementation brief](../../docs/testbed-plan.md) contains confirmed direction, compatibility investigations and staged acceptance. The separate [execution report](../../docs/test-workspace.md) records another agent's dated scratchpad experiments; this guide did not rerun them. Those suite links may be unavailable in an independent clone; local source references below remain usable.

## The two execution roles

```text
Legacy Engine
  compiles/serves Packages implementation modules as ESM
    → modern BEE Node loader
      → Node executes Packages implementation
        → Packages development HTTP service
          discovers/resolves/compiles/serves testbed app and shared module
            → browser runtime/Widgets, types, styles and HMR
```

The owner selected this direction. The [verified hello](../../bee-node/README.md) established a narrow Engine → implementation ESM → BEE Node execution circuit. It did not start the complete new service or establish that Packages serves a widget application. Extend that circuit instead of asking whether Packages should continue using Beyond.

Engine may remain running to compile the implementation throughout the target acceptance run. The distinction is which generation produces the **target app's artifacts**, not whether an Engine process exists. An Engine-rendered application is a baseline/reference, not a replacement final product. Keep bootstrap origin, target artifact origin and compiler provenance explicit in test results.

[Existing server fixture](../tests/test-server/index.js) uses installed legacy BEE and global bimport. The report observed its Express shell starting, but the [module handler](../modules/http/routes/modules/index.ts) still contains a fixed builder. Modern BEE Node has no global bimport or HMR today. The [bundler importer](../modules/package/main/bundlers/importer.ts), [processor importer](../modules/sdk/conditional/processors/base/importer.ts) and API server wrapper retain those assumptions. Bridging them and exposing awaited ready/error/stop are bounded integration work needed to run the full implementation through the selected modern loader, not already passing behavior.

## Start from the existing design

The [Workspace](../modules/workspace/index.ts) discovers local packages. [Package](../modules/package/main/index.ts) owns configuration, registered bundlers and modules. The [resolver](../modules/package/main/modules/resolver.ts) chooses a bundler Module implementation. [SDK](../modules/sdk/conditional/main/index.ts) coordinates conditional processors; [ESM assembly](../modules/sdk/conditional/esm/index.ts) and [ConditionalOutput](../modules/module/output/index.ts) already express the packaging structure to complete.

Preserve these responsibilities and public-module boundaries. Internal source files are not automatically separate public modules; a packaged module may combine them while retaining bare imports to other public modules. Source-file, package-version and public-module graphs serve different purposes. Runtime resolution must map public names to selected version/condition artifacts, and declarations/editor resolution must agree without rewriting the author's imports. Modular CSS needs its own generation, delivery and runtime adoption/update path.

The manifest finder currently reads beyond.modules while older authoring fixtures use top-level modules. The selected bundler can be unready when its collection appears ready. ESM assembly contains placeholder identities and places ESM exports inside a function. These are concrete compatibility gaps/defects; do not interpret them as proof that the architecture is unspecified. Inspect nearby types, consumers and lifecycle before proposing new abstractions. Record manifest precedence/backward compatibility and the required kernel/exports/styles/HMR ABI before any incompatible change. Completing the evidenced internal-module design is the first investigation; plain ESM with a new adapter would need justification, not automatic selection.

## Next work and completion evidence

Follow the suite brief in dependency order: extend the modern bootstrap; establish a baseline fixture; fix discovery and selected-bundler readiness; produce executable module output; resolve the shared package; connect real HTTP output; then add/prove browser widget bootstrap, modular styles, declarations, watchers and HMR. Reuse the SDK rather than implementing an unrelated server around static files.

The target testbed has a real widget and an independently served public shared module, for example @suite/shared/message. Its exact directory, ports and React 18 baseline are proposals, not reasons to reopen the product architecture. Final evidence must show source-derived results, unchanged public bare references, correct resolution, actual shadow-root styling/types and separately labelled JS/CSS update behavior. A fixed hello response, static substitute, Engine proxy compilation, relative-import rewrite or fake TypeScript paths configuration does not satisfy it. A reload proves less than HMR; record that difference.

CDN v2 is an independent consumer intended to reuse Packages' artifact capabilities. Keep service startup, persistence and deployment out of library import side effects. The [Kernel/Local source and HMR map](../../docs/bee-node-hmr.md) describes existing runtime consumers to preserve; the owner-designated [new development runtime](../../local-2026/README.md) is the new Beyond-authored package, while exact APIs and migration remain open. The CDN branch choice is still open; local target progress does not require a cloud deployment. Workspace 2026 consumes these foundations but its UI/provider choices are not prerequisites for repairing this implementation.

All current checkouts use feature/next; main/dev in older guides identify baselines. This guide documents direction and acceptance only. It does not authorize source changes, installs, services, commits or publication during a documentation-only task.

Current naming and scope: the new Beyond-authored client runtime will unify Kernel/Local development capabilities for local and cloud servers while preserving production-needed runtime behavior. `local-2026/` is the provisional checkout, not the approved final name. Dev is only under consideration. No rename, new runtime implementation or finalized migration was performed; see [the handoff](../../local-2026/README.md).
