# Sources fixture: packages published as Beyond sources, installed from a registry

The workspace and the registry releases that [`sources.test.mjs`](../../sources.test.mjs) installs and serves. The harness, [`support/sources.mjs`](../../support/sources.mjs), publishes every directory of `registry/` (its manifest, and every other file below `package/` of its archive) on an in-process registry, copies `workspace/` into a unique temporary directory, installs it with `Installation` into a temporary store, and builds the Packages workspace and delivery from the members of the copy and the projection of its installed graph, as the development service does. Nothing is written here by a run, and nothing reaches a public registry.

The first-party packages a project installs (the development runtime, Widgets and its framework controllers) are published as Beyond sources: `@sources/runtime` stands in for the runtime and `@sources/lib` for Widgets.

## Workspace

| Member | Package | Module | Imports |
| --- | --- | --- | --- |
| `app` | `@sources/app` 1.0.0, `ts` bundler composed on `@sources/runtime/bundle` | `./main` | `@sources/lib/greeting` |

`app` declares `@sources/runtime`, the runtime it is composed on, as an application declares the development runtime, and every release below, so that each is a node of the installed graph.

## Registry releases (`registry/`)

| Release | Declares | Modules | Expected |
| --- | --- | --- | --- |
| `@sources/runtime` 1.0.0 | Source form, the packaging bundler (`esbuild`), TypeScript entry points in `exports` | `./bundle`, `./core` (imports `@sources/runtime/bundle`) | Compiled from its TypeScript by the compiler of the environment, confined; `./core` references the bundle instead of carrying it. Before the source form was honoured with an installed graph, `./bundle` was `OUTPUT_NOT_AVAILABLE` ("resolves to `./bundle/index.ts`, which is not code or a stylesheet") |
| `@sources/lib` 1.0.0 | Source form, the `ts` bundler composed on `@sources/runtime/bundle`, which it does not declare; depends on `tone` | `./greeting` (imports `@beyond-js/kernel/core` and `tone`, with `styles.css`), `./loose` (imports `extra`) | `./greeting` is composed by the `ts` bundler (key `web`, `web/production`), its Kernel import mapped to `@sources/runtime/core` and classified as the runtime, `tone` as the external node its own edge reaches, its stylesheet built by its processors; the package is read from the node's location with the identity `[key, integrity]`. `./loose` is `DEPENDENCY_NOT_INSTALLED`: `extra` is the application's dependency, not the library's |
| `tone` 1.0.0, `extra` 1.0.0 | Ordinary npm packages | `.` | Compiled by the packaging path from their `exports` |
| `@sources/refused` 1.0.0 | **Intentionally hostile**: source form whose `ts` bundler is a `data:` program that would set `globalThis.sourcesRefusedRan` | `./main` | `PLUGIN_REFUSED` (with `INVALID_BUNDLER`): the toolchain does not ship it, so it never runs and nothing else compiles the module |
| `@sources/unregistered` 1.0.0 | Source form whose default bundler `ts` its `bundlers` do not register; a TypeScript entry point in `exports` | `./main` | `BUNDLER_NOT_FOUND`, never compiled by the packaging compiler instead |
| `@sources/unreadable` 1.0.0 | A publication declaration of protocol `beyond-publication/9` | `./main` (plain JavaScript) | `PUBLICATION_PROTOCOL_UNKNOWN`: a declaration that cannot be read selects no form, so not even the npm path compiles it |
| `@sources/undeclared` 1.0.0 | A Beyond bundler and no `beyond.publication`; a TypeScript entry point in `exports` | `./main` | Read as an ordinary npm package, as the preparation for delivery reads it: `OUTPUT_NOT_AVAILABLE`, with the warning `PUBLICATION_UNDECLARED` among its diagnostics |

The registry is the CDN resolution validation's `FakeRegistry`; it is not `registry.npmjs.org`, so every node is addressed under the registry id Packages' resolution gives it (`/m/<registry id>/…`).
