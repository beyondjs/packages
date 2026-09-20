# Unified-runtime validation: composed modules on the development runtime

Validates that Packages compiles the development runtime (the provisional `local-2026` package) and composes a workspace against it, and that a source edit reaches a consumer that is already running, first with the driver naming each update and then end to end through the development service, with nobody naming it.

The runtime is compiled in the esbuild packaging mode with the Beyond ESBuild fork, because a composed artifact imports its runtime and the runtime therefore cannot be composed by itself. The fixture packages in [`fixture/`](fixture) select it with the `runtime` setting of their bundler. Every run works on a temporary copy that holds the fixture and the runtime sources, so neither is edited.

## Prerequisites

Those of [the stage-1 validation](../stage-1/README.md) (Engine serving this implementation on 1112, Engine serving the watchers utility on 1120, BEE Node) and of [the packaging trial](../esbuild-packaging/README.md) (`node beyond/prepare.mjs && node beyond/package.mjs` in the Beyond ESBuild checkout). `BEYOND_RUNTIME` locates the runtime checkout when it is not `local-2026` beside this repository. The drivers set `BEYOND_ESBUILD_COMPILER`, the variable the runtime manifest names, to the compiler of `BEYOND_ESBUILD`.

## Run

```sh
BEYOND_ESBUILD=/absolute/path/to/beyond-esbuild BEE_URL=http://localhost:1112 WATCHERS_URL=http://localhost:1120 \
  node --import "$BEE_NODE_DIR/register.mjs" tests/unified-runtime/index.mjs
BEYOND_ESBUILD=/absolute/path/to/beyond-esbuild BEE_URL=http://localhost:1112 WATCHERS_URL=http://localhost:1120 \
  node --import "$BEE_NODE_DIR/register.mjs" tests/unified-runtime/service.mjs
```

Expected: `6/6 steps passed` and `7/7 steps passed`.

## What each run establishes

`index.mjs`, composition and the application of updates. The driver builds with `Artifacts`, the consumer resolves through the import map, and the driver names each update file, so this run does not claim delivery.

| Step | Established |
| --- | --- |
| composition | The runtime artifact is `packaged`, built by the compiler selected as `env:BEYOND_ESBUILD_COMPILER` and reported with its location; the composed artifacts import `@beyond-js/local-2026/bundle` and do not name the legacy Kernel |
| execution | Both packages register in one runtime registry and nothing registers in the legacy Kernel, which stays importable because it is installed beside this repository |
| update | After a watched edit of an internal module, a function that reads it, the public re-export read through the original import of another public module, and the module's own export are current in the same update; the stateful internal module keeps its state; evaluation counts are 1, 2, 1. Recorded boundary: a value the unchanged entry point computed when it was evaluated is not recomputed |
| entry replaced | The entry point that re-exports is itself replaced, which the legacy Kernel refuses; the store is not evaluated again |
| recovery, build | A source that does not compile publishes nothing and leaves the consumer as it was; its correction updates the same process |
| recovery, evaluation | A source that compiles and throws when evaluated fails that update; its correction is applied, where the legacy Kernel reports a cyclical import from then on |

`service.mjs`, end to end. It starts the real host of the development service (`service/host/main.mjs`, in its bootstrap form, with the `@beyond-js/packages/development` extension) as its supervisor does and attaches as its owner. The consumer is a separate Node process with `BEE_ADAPTER=packages` that loads everything from the service and calls `local.register({ origin })`. The driver only edits files.

| Step | Established |
| --- | --- |
| service | The session publishes the fixture modules and both runtime modules, all valid |
| consumer | The connection is `ready` and both packages are registered |
| update | The edit is observed by the service, built, announced as `build.ended` and applied by the runtime from `/u/<hash>/…`: same assertions as above, only the changed module triggers `change`, and no `error` is recorded |
| failure and recovery | An invalid source arrives as `invalid` with its diagnostics and changes nothing; the correction is applied |
| order | Two saves 60 ms apart end in the last one, without errors |
| restart boundary | After the service is stopped and started again at the same origin, the runtime connects again, receives `resync` (`EPOCH`), reports `stale` and applies nothing more: the later build is not applied |
| lifecycle | After `local.close()` nothing is applied |

## What it does not cover

Browsers are covered by [the preview validation](../preview/README.md), which applies an update to a running page. Styles, Widgets and the other families of the legacy Kernel are not covered: see the runtime's own guide of what is implemented. Updates of modules compiled in the esbuild packaging mode, which receive none. Duplicate and superseded notifications were not forced. The `/u/` route is provisional and outside the compiled-module contract. The service is accepted as an installed product by the command line's acceptance suite, not by this run, which starts its host from the checkout.
