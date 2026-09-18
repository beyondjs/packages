# Packages capabilities for local execution

This guide describes what Packages provides to a development service and a command line that execute public modules: the authoring forms a package can use, how a request for conditions selects a conditional, how a selector becomes a module, how one module is delivered on request, and the guarantees an artifact gives. Each statement is exercised by [the baseline validation](../tests/cli-baseline/index.mjs), which builds temporary workspaces and executes their artifacts in a separate Node process.

```sh
BEE_URL=http://localhost:1112 node --import "$BEE_NODE_DIR/register.mjs" tests/cli-baseline/index.mjs [defects|declarations|selection]
```

It runs like [the first-stage validation](../tests/stage-1/README.md), from this directory and with the implementation served by Engine, but it needs no watchers service and never edits the suite testbed.

## Authoring forms

Every form leads to the same public module. The manifests below are complete: nothing else is configured.

| Form | `package.json` | Module files |
| --- | --- | --- |
| Exports only | `"exports": { "./greet": "./greet/index.ts" }, "beyond": { "bundler": "ts" }, "bundlers": { "ts": "@beyond-js/packages/bundlers/ts" }` | `greet/index.ts` |
| Manifest only | `"beyond": { "modules": ".", "bundler": "ts" }, "bundlers": { … }` | `greet/module.json`: `{ "entry": "index.ts", "platforms": ["node"] }` |
| Combined | `"exports": { "./utils/greet": "./utils/greet/index.ts" }, "beyond": { "modules": "." }, "bundlers": { … }` | `utils/greet/module.json`: `{ "bundler": "ts", "platforms": ["node"] }` |
| Root through exports | `"exports": { ".": "./src/index.ts" }, "beyond": { "bundler": "ts" }, "bundlers": { … }` | `src/index.ts` |
| Root shorthand | `"exports": "./src/index.ts", …` | `src/index.ts` |
| Root through main | `"main": "src/index.ts", …` and no `exports` | `src/index.ts` |

- `bundlers` registers an alias for a public implementation specifier. `beyond.bundler` is the default for modules that select none; a manifest selects one with `bundler`. Without a registry the package is told how to add one (`BUNDLERS_NOT_REGISTERED`), and a module with no selected bundler is reported, not guessed.
- `beyond.modules` enables the discovery of `module.json` files. A manifest-only module names its `entry`; without one it is `MODULE_ENTRY_MISSING`.
- When `exports` is present it defines everything the package publishes: an omitted root is not restored from `main`. A `main` that is not a source file publishes nothing and warns (`MAIN_NOT_SOURCE`).
- Root conditions (`{"import": …}`), fallback arrays and subpath patterns (`"./*"`) are rejected with `EXPORTS_UNSUPPORTED`. A `null` target keeps a subpath private. This is a deliberate subset, not Node's complete `exports` semantics.
- `exports` and `main` are read from the manifest as written. They are not configuration branches, because a branch whose value is a string names a file to load.

## Conditions

`Conditions` (public, in `@beyond-js/packages/artifacts`) holds the requested conditions and selects the conditional of a module that satisfies them: the exact `platform/environment`, then the `platform`, then the platform-neutral conditional. A module that declares its `platforms` is built only for them, and requesting another is `CONDITIONAL_NOT_FOUND`. A module that declares none, which is how an exports-only package is authored, produces one neutral conditional that satisfies every request. Writing artifacts, delivering them and launching a consumer use this one mapping.

## Selectors

`Selector` and `Selection` (public, in `@beyond-js/packages/workspace`) turn what a user typed into a declared public module. `@scope/name[@version][/subpath]` names a package; `.` and `./subpath` name a module of the package that contains a directory. A version is exact and must equal the version of the workspace package (`VERSION_MISMATCH`); ranges and tags are `SELECTOR_VERSION_UNSUPPORTED`. Paths, including `../x` and absolute ones, are `SELECTOR_INVALID`. A local selector without a containing package is `SELECTOR_PACKAGE_REQUIRED`: a coincidentally unique module name is never searched for. Two workspace packages with one name are `PACKAGE_DUPLICATED`, with both locations. A missing module lists what the package declares and why a declared module could not be resolved.

`new Workspace(path, { packages: ['.'] })` takes its packages from the caller instead of a `beyond.json`, which is how a standalone package is a workspace of one without a file being written into it. Paths given to `Workspace` are absolute.

## Delivery

`Delivery` (public, in `@beyond-js/packages/artifacts`) compiles one module on request and returns its code, hash, update and resolved dependencies, or a failure with the codes of the compiled-module contract: `PACKAGE_NOT_FOUND`, `VERSION_MISMATCH`, `MODULE_NOT_FOUND`, `BUILD_FAILED`. It writes nothing and starts no server. `published()` lists every declared public module with the directory of its package. The [HTTP routes](../modules/http/routes/index.ts) mount on an Express application that the caller owns and answer with a `Delivery`, parsing requests with `@beyond-js/artifact-api`; the specification that used to be copied under `openapi/` lives in that package.

## Artifact guarantees

- A module is valid only when it compiles and every public dependency is satisfiable. A module with a missing, undeclared or incompatible dependency is not written, not mapped and not delivered.
- `Artifacts.build()` owns the files named after its conditions inside versioned package directories, and removes the ones it did not write again: the artifact of a module that stopped building, or is no longer declared, does not stay reachable. Files of other conditions are left alone.
- A default export is a live binding (`export { _default as default }`), assigned by the runtime like the named ones, and `_default` is not part of the public API.
- The update closure declares no parameters and reads its call from `arguments`, so an export named `value`, `prop` or `require` keeps its value. The names an artifact declares for the runtime (`hmr`, `__beyond_pkg`, `__pkg`, `__ims`, …) cannot be exported: `EXPORT_RESERVED`.

## Authoring note for this implementation

Engine classifies a dependency of a bundle by the first import statement that names the specifier. A type-only import followed by a value import of the same specifier drops the runtime dependency, and the bundle fails with "is not registered as a dependency". Use one statement: `import { Selection, type Workspace } from '@beyond-js/packages/workspace'`.

## Limits

Module and package manifests are not watched: a development service reloads its workspace when they change. Re-exports remain a restart boundary of the installed runtime. Declarations, styles, browser execution and a push channel for updates are outside this guide.
