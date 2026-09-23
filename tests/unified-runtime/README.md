# Unified-runtime validation: composed modules on the development runtime

Validates that Packages compiles the development runtime (the provisional `local-2026` package) and composes a workspace against it, and that a source edit reaches a consumer that is already running, first with the driver naming each update, then end to end through the development service, with nobody naming it, and then in several environments (Node.js, Deno) with notifications from the service or from an external emitter.

The runtime is compiled in the esbuild packaging mode with the Beyond ESBuild fork, because a composed artifact imports its runtime and the runtime therefore cannot be composed by itself. The fixture packages in [`fixture/`](fixture) (see [its README](fixture/README.md)) select it with the `runtime` setting of their bundler. Every run works on a temporary copy that holds the fixture and the runtime sources, so neither is edited.

## Prerequisites

Those of [the stage-1 validation](../stage-1/README.md) (Engine serving this implementation on 1112, Engine serving the watchers utility on 1120, BEE Node) and of [the packaging trial](../esbuild-packaging/README.md) (`node beyond/prepare.mjs && node beyond/package.mjs` in the Beyond ESBuild checkout). `BEYOND_RUNTIME` locates the runtime checkout when it is not `local-2026` beside this repository. The drivers set `BEYOND_ESBUILD_COMPILER`, the variable the runtime manifest names, to the compiler of `BEYOND_ESBUILD`. `environments.mjs` also needs a Deno 2 executable, named by `BEYOND_DENO`; it runs with `--allow-net --allow-import --allow-env` and a module cache of its own in a temporary directory.

The utilities validation of the suite (`utils/validation/served.mjs`) can serve this implementation and the utilities from their sources on free ports instead of the Engines on 1112 and 1120; it sets `BEE_URL` to the list of its servers and `WATCHERS_URL`, and `PACKAGES_SOURCE` serves a copy of this repository, which is how a run stays attributable while the working tree changes.

## Run

```sh
BEYOND_ESBUILD=/absolute/path/to/beyond-esbuild BEE_URL=http://localhost:1112 WATCHERS_URL=http://localhost:1120 \
  node --import "$BEE_NODE_DIR/register.mjs" tests/unified-runtime/index.mjs
BEYOND_ESBUILD=/absolute/path/to/beyond-esbuild BEE_URL=http://localhost:1112 WATCHERS_URL=http://localhost:1120 \
  node --import "$BEE_NODE_DIR/register.mjs" tests/unified-runtime/service.mjs
```

```sh
BEYOND_ESBUILD=/absolute/path/to/beyond-esbuild BEYOND_DENO=/absolute/path/to/deno BEE_URL=http://localhost:1112 WATCHERS_URL=http://localhost:1120 \
  node --import "$BEE_NODE_DIR/register.mjs" tests/unified-runtime/environments.mjs
```

Expected: `6/6 steps passed`, `7/7 steps passed` and `10/10 steps passed`.

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

`environments.mjs`, one runtime in several environments and with several emitters. Five consumers run [`environment-consumer.mjs`](environment-consumer.mjs) against one service and one fixture: `node/stream`, `node/object` and `node/notify` in Node.js under BEE Node (`BEE_ADAPTER=packages`), `deno/stream` and `deno/relay` in Deno, which resolves through the service's `importmap.json?target=node&format=esm` when the service publishes it, and otherwise through an import map the driver writes from `/session` (the step says which). `stream` consumers read the event stream of the service; the others receive the events of [the relay](relay.mjs), a stand-in external emitter that reads the service's stream like any subscriber and relays every event document unchanged, `resync` included: `deno/relay` reads the relay's own event stream at another origin (`events: <url>`), `node/object` is given an object source the driver feeds, and `node/notify` registers with `events: false` and receives the events through `local.hmr.notify()`. [channel.mjs](channel.mjs) is the driver's side of a consumer process (requests on stdin, answers on stdout lines prefixed with `@@`).

| Step | Established |
| --- | --- |
| service | The service serves the workspace, the runtime included, every module valid |
| relay | The external emitter is subscribed to the service |
| consumers | Every consumer is `ready` with its source (`stream`, `object`, `none`), platform `node`, its environment (`node` or `deno`) and the `module` loader; both packages registered; the stylesheet of `@fixture/shared/text` registered; `notify()` refuses a value without `type` with a `TypeError` |
| update | A saved source is applied everywhere: direct exports and re-exports current, store kept, evaluation counts 1, 2, 1, no `error`; the build lists the runtime's coordinator valid for `node` and `web` with no diagnostic |
| invalid build | `invalid` for the module everywhere, nothing changes; the correction is applied |
| evaluation failure | A source that throws when evaluated is reported as `error` with its exception everywhere; the correction is applied with the store kept |
| stylesheet | A new sheet replaces the registered one (a new version, addressed by its hash on `/u/`, with the new rule); an invalid sheet is `invalid` and the registered sheet stays as it was; the correction replaces it |
| order | Two saves 60 ms apart end in the last one everywhere, without errors |
| restart boundary | After the service restarts at the same origin, every consumer reports `stale` (`EPOCH`), through its own reconnection or through the relay's; the next build reaches every consumer and nothing is applied |
| lifecycle | `close()` releases every connection and source |

## What it does not cover

Browsers, SystemJS pages and document stylesheet links are covered by [the preview validation](../preview/README.md). Widgets and the other families of the legacy Kernel are not covered: see the runtime's own guide of what is implemented. In Node.js and Deno a stylesheet is only held by the registry: nothing loads it, so a sheet that fails to load is not a case here. Deno's module graph also requests the names the composed creators pass to their internal `require()` (`/m/<package>@<version>/modules/<internal module>`), which the service does not serve; they change nothing, and the consumers run as in Node.js. Updates of modules compiled in the esbuild packaging mode, which receive none. Duplicate and superseded notifications were not forced. The `/u/` route is provisional and outside the compiled-module contract. The service is accepted as an installed product by the command line's acceptance suite, not by this run, which starts its host from the checkout.
