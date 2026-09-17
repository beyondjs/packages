# Programming conventions

Packages is authored with Beyond and should remain recognizable as a collection of public modules implemented by focused internal files and collaborating objects. These conventions explain the current programming model and how to extend it while preserving public contracts. Use [architecture and SDK](architecture.md) for actual extension APIs and [development](development.md) for execution and acceptance boundaries.

## Think in public modules, then internal files

The package is `@beyond-js/packages`. A public module is a separately addressable API such as `@beyond-js/packages/module/spec`. Its internal files implement that API; creating another file does not create another public module.

For example, [the package module manifest](../modules/package/main/module.json) publishes `package`. Its [entry source](../modules/package/main/index.ts) exposes `Package` and composes internal `attributes`, `bundlers`, `controller`, and `modules` implementations through relative imports. Those internal collaborators need not become public modules simply because they have their own directories. Conversely, [module/spec](../modules/module/spec/module.json) and [module/output](../modules/module/output/module.json) are explicitly separate public modules used through bare imports.

**Recommended boundary decision:** extend an existing module when the behavior is an internal responsibility of its API. Consider a new public module when another module needs a deliberate reusable contract, with an independently meaningful identity. The source supports this distinction; it does not establish a rigid size, file-count, or one-class-per-module rule. Follow the nearest current family before inventing a new partition.

Compiled public-module references remain bare specifiers. The architectural dependency graph connects those public modules; relative source-file dependencies are internal implementation detail. The package/version graph is a separate supporting layer.

## Authoring and discovery

[Root package.json](../package.json) names the package and sets `modules.path` to `modules`; [beyond.json](../beyond.json) selects that package for the bootstrap engine. Module manifests use both `name` and `subpath` forms; these must be interpreted by their actual consumer rather than inferred from folder names.

A representative existing authoring manifest is:

```json
{
  "name": "module/spec",
  "bundle": "ts",
  "files": "*",
  "types": []
}
```

This is copied from [module/spec](../modules/module/spec/module.json). Treat public identity as configured, not a mechanical transformation of folder names: `modules/module/main` publishes `module`, `modules/http/start` publishes `http/server`, and `modules/persistence/types/common` publishes `persistence/types`. The physical `deoendency-source` spelling also differs from the public `dependency-source` name. Preserve existing public identifiers and physical paths unless their migration is explicitly scoped.

There is a concrete distinction between authoring Packages with the old engine and configuring the framework Packages implements. Its newer [finder](../modules/package/main/modules/manifests/finder.ts) reads `config.beyond?.modules`, whereas the root authoring manifest and existing TS fixture use top-level `modules`. The [new manifest type](../modules/types/package/index.ts) also declares `beyond.modules`. The finder excludes `builds` and `node_modules`. These differences are not a single validated universal configuration recipe. The `subpath`-only authoring manifests likewise should not be treated as proof that the older bootstrap parser handles that field. Check the exact consumer before adding or copying configuration; the two configuration layers remain distinct.

## Names: let context carry meaning

**Structural naming principle:** compound names are allowed in class definitions. In usage code, avoid compound names as much as possible. When a method, property, or other identifier needs a compound name, ask whether it is carrying a responsibility that belongs in an object/class exposing a simply named operation or property. Express context through structure rather than repeatedly encoding it in identifiers.

This is a design question, not blind abbreviation, a ban on class composition, or an instruction to split every identifier. Existing compound class names such as `ModuleSpec`, `ConditionalOutput`, `PackageController`, `ModuleManifestsFinder`, and `DependenciesGraph` are compatible with that principle.

Actual usage illustrates the direction: [the dependency fixture](../tests/test-dependencies/test-dependencies.js) calls `project.dependencies.install()` and reads `project.dependencies.print.tree`. Responsibilities live in collaborating objects, so the caller does not need a method named `installProjectDependencies` or a property named `printedProjectDependencyTree`. Those alternative names are explanatory counterexamples, not identifiers found in the source or proposed renames. Similarly, [Package](../modules/package/main/index.ts) exposes `bundlers`, `modules`, and `watcher` collaborators.

Hierarchical paths carry context too: `module/spec`, `project/local`, `providers/settings`, and internal `registry/package/nodes` directories. Files such as `spec.ts`, `version.ts`, and `conditional.ts` can use short names. Within [graph/node](../modules/dependencies/graph/node/index.ts), `Node` and its relative `Version` import have an explicit surrounding context. Internal classes `Plugin`, `Wrapper`, and `Conditional` in the exports bundler provide another example.

Observed usage is not perfectly uniform. [NodeDependencies](../modules/dependencies/graph/node/dependencies.ts) aliases a type as `DependencyNode`; inherited APIs include `setMaxListeners`, and external contracts/configuration include names such as `devDependencies`. Do not silently normalize these APIs or remove useful disambiguation. Public paths such as `dependency-source` are existing contracts. Apply the design question when developing new responsibilities, preserve compatibility, and record uncertainty where a structural change needs a broader decision.

## Public API and imports

The public export marker is `export /*bundle*/`. Ordinary TypeScript `export` still connects internal files; it does not automatically mean a public Beyond API. Public classes, types, interfaces, functions, and constants use the marker in current source. A marked declaration can live in a nested internal file; `index.ts` is not necessarily a single public barrel for the whole module. Do not convert an internal helper into public API just to make an import convenient.

This excerpt shows actual patterns from [ModuleSpec](../modules/module/spec/index.ts):

```ts
import type { ExportsType, IManifestModuleSpec } from '@beyond-js/packages/types';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';
import { equal } from '@beyond-js/equal/main';

export /*bundle*/ type ModuleSpecType = ExportsType | IManifestModuleSpec;
```

And [Package](../modules/package/main/index.ts) imports its internal collaborators relatively:

```ts
import Attributes from './attributes';
import { Bundlers } from './bundlers';
import { PackageController } from './controller';
import { Modules } from './modules';
```

Use bare package/module specifiers across public module boundaries, including boundaries inside this package. Use relative imports inside a module. Type-only dependencies commonly use `import type`. The current TS export extractor has narrower supported cases than all TypeScript export syntax, so a marker is not a guarantee that every declaration form works in the newer processor; the [SDK guide](architecture.md) records its limits. These are excerpts, not standalone runnable examples or new proposed APIs.

## Formatting and type vocabulary

The checked-in [.prettierrc](../.prettierrc) specifies tabs, width 120, single quotes, no trailing commas, and omission of parentheses for a single arrow parameter. Match neighboring source and the actual configuration.

Current code uses PascalCase classes, camelCase members, many `I`-prefixed interfaces, and several `...Type` aliases. These coexist with interfaces and aliases that do not follow those suffixes. Type-only imports and explicit boundary types are common, while `any`, assertions, and less strict retained JavaScript also exist. Follow the surrounding contract rather than claiming uniform strictness across the repository. Per-module tsconfig files exist; they do not establish one root type-check command.

## State, collaborators, and lifecycle

Current classes commonly use ECMAScript `#private` fields with public getters: [Package](../modules/package/main/index.ts), [ModuleSpec](../modules/module/spec/index.ts), and [graph Node](../modules/dependencies/graph/node/index.ts) are representative. Getters can expose live Maps or arrays; they do not guarantee immutable state. Composition supplies context: Package owns Bundlers/Modules/Controller, BaseModule owns Conditionals, and ConditionalProcessor owns Settings/Spec/Sources/Outputs. Inheritance, static helpers, and exported singleton instances also occur; there is no rule that every responsibility must use one construction pattern.

`DynamicProcessor()` provides the processing lifecycle used by several families, sometimes applied to `Map`. The [conditionals collection](../modules/module/main/conditionals/index.ts), [SDK conditional](../modules/sdk/conditional/main/index.ts), and [processor base](../modules/sdk/conditional/processor/index.ts) show the recurring responsibilities:

| Hook or member | Observed role |
| --- | --- |
| `dp` | Contextual identifier for a processor |
| `super.setup(...)` | Register child processors whose state processing depends on |
| `_prepared(require)` | Declare or await additional processing dependencies |
| `_process(...)` | Derive/update state after prerequisites are available |
| `_spec(...)`, `_settings(...)` | Select relevant values that drive invalidation |
| `destroy()` | Release owned collaborators and subscriptions where implemented |

These are framework hooks, not arbitrary names to shorten. Follow the owning base class's contract when extending a processor; do not apply this lifecycle to unrelated classes automatically. Async processors such as [Bundler](../modules/package/main/bundlers/bundler.ts) and ConditionalProcessor compare `request !== this._request` after awaited work so stale results are not published. Preserve that pattern when changing those paths.

Initialization varies: some consumers await `ready`, while [provider settings](../modules/providers/settings/main/index.ts) expose `load()` and [the database façade](../modules/persistence/db/index.ts) requires `init()`. Establish which protocol a collaborator uses before reading its results. A returned `ready` promise alone is not proof that all work succeeded; inspect the corresponding diagnostics.

**Recommended ownership practice:** identify who creates a collaborator, who subscribes to it, and who destroys it when removed. The conditionals collection destroys removed children. Other current paths are inconsistent: Workspace clears its package map before its cleanup iteration, and Package calls `watcher.destroy()` despite optional watcher creation. These lifecycle defects are not patterns to copy unquestioningly.

## Conditions, diagnostics, and asynchronous operations

[BaseModule](../modules/module/main/index.ts) delegates output selection through `_conditionals()` and `_conditional(...)`. Specialized bundlers supply their own implementations. Separately, the persistence façade chooses local/CDN adapters through `bimport` during initialization. These illustrate environment-specific responsibilities; they do not prove every adapter is selected through the same conditional-export mechanism or supports every target.

Configuration/processing diagnostics often use `{ code, message }`, `errors`/`warnings` arrays, and `valid`. Local `done(...)` helpers collect state updates, sometimes comparing previous and next values with `equal`. [Workspace](../modules/workspace/index.ts) and the bundler registration are examples. Invalid programmer inputs can throw; [HTTP handlers](../modules/http/routes/modules/index.ts) pass failures to `next(error)`. Both Logger and direct console calls occur. Match the layer's contract rather than imposing a universal rule to throw, swallow, or log every error.

HTTP loading and HMR aim to avoid intermediate generated files in the normal loaded-bundle workflow. That is not a blanket implementation property: the [exports conditional](../modules/bundlers/exports/conditional.ts) uses esbuild with `write: false` but then writes a debug `output.js`. Preserve the architectural goal without describing all current side effects as absent.

## Writing and understanding tests

Current tests mix diagnostic/integration scripts and assertion-based examples. [The dependency script](../tests/test-dependencies/test-dependencies.js) bootstraps BEE, awaits initialization, installs dependencies, and logs a tree. [The adjacent Jest-style test](../tests/test-dependencies/test-dependencies-resolution.test.js) uses `beforeAll`, table-driven cases, and `expect`, but references older public module names. [The workspace test](../tests/test-workspace/test-workspace.ts) is a placeholder. File naming does not establish a working runner or passing assertions.

Packages itself is authored with Beyond, so existing tests consume compiled modules through the older engine and transitional legacy BEE runtime in older fixtures; new integration uses modern BEE Node. Distinguish isolated business-logic tests, compiled public-module contract tests, and HTTP/HMR integration tests. These are proposed boundaries for repeatable testing, not an instruction to bypass compilation everywhere or adopt a new toolchain now.

## Active and retained implementation

Use current TypeScript entrypoints and their imports as the primary convention reference. Paths marked `_older`, `_to-refactor`, or `trash` retain useful designs but are not default templates for new work. Not every unfinished file carries such a label, and not every unlabelled file is wired into an active path. Preserve useful mechanisms while completing the selected public contract.
