# Development service

The development service is the Dev Server of Packages for one workspace: it hosts Packages for that workspace, serves its compiled public modules over the compiled-module API (`@beyond-js/artifact-api`), describes and checks the workspace for its clients, and ends according to who is using it. It is part of the `@beyond-js/packages` distribution, under [service/](../service/index.mjs), and its clients import `@beyond-js/packages/service`. The Beyond command line and the environment of a Workspace project are two such clients. Importing it starts nothing.

```js
import { Context, Service } from '@beyond-js/packages/service';

const context = new Context({ directory: process.cwd() });          // which workspace
const service = new Service(context);
const { connection, started, token } = await service.acquire({ lifetime: 'owner' });

await connection.attach(started ? 'owner' : 'session', { token, stopping: reason => {} });
connection.origin;                                                   // http://127.0.0.1:<port>
await connection.selection('@example/app/main', context.directory); // resolved module + whether its graph builds
```

## Development serving, distribution and the bootstrap

Four things are easy to confuse and are kept apart here.

| | What it is | State |
| --- | --- | --- |
| The Dev Server of the target application | This service: Packages compiling and serving **the user's workspace** while it is developed. | Implemented and accepted through the command line. |
| Compilation for distribution | Building a package into compiled outputs that are consumed without its author's Dev Server. A core capability of Beyond, which applies to Packages itself. | Not provided by this service. See [what remains](#engine-independent-distribution-what-exists-and-what-remains). |
| Publication | Putting a built distribution in a registry. | Separate from building, and not performed. |
| The bootstrap of the implementation | Engine compiling and serving **Packages' own source**, because this distribution of Packages carries sources. | Transitional, automated, and isolated in its own package. |

The service never knows how the implementation of Packages became importable. [Implementation](../service/implementation.mjs) answers that once, when a service starts:

- A **compiled** distribution declares its compiled public modules in the `exports` of its manifest, so Node resolves `@beyond-js/packages/workspace` and the rest by itself. Nothing is prepared, no other process runs and the host is an ordinary Node process.
- A distribution that **carries sources**, which is what exists today, needs them compiled and served first. That is done by the separate [`@beyond-js/packages-bootstrap`](../bootstrap/README.md) package, which starts Engine for that purpose and returns how to start the host against it.

Either way the supervisor receives a launch description (`execArgv`, `env`, `cwd`, how to start the watchers service, the process groups that were started) and does the same with it. Discovery, attachment, lifetime and cleanup are identical in both forms, and removing the bootstrap package is the whole migration once a compiled distribution exists.

### Why the service is inside this distribution

The service is the Dev Server that Packages owns, it has no dependency that Packages does not already have a reason for (`express` for the HTTP routes Packages defines, `@beyond-js/kernel` as the runtime its artifacts import, `@beyond-js/artifact-api` for the contract), and a consumer that only compiles, such as CDN delivery, pays nothing for files it does not import. Nothing about its lifecycle justifies a second package.

What does have its own package is the bootstrap, for a reason that is independent of where startup code is written: its dependencies are a second compiler (Engine, with its whole tree), a loader used only to reach that compiler, Node type declarations for it and the dependencies of a service compiled from bundled source. None of them belongs to a compiled Packages, and declaring them in `@beyond-js/packages` would install them for every consumer forever. `@beyond-js/packages-bootstrap` is a provisional name; its availability in a registry has not been checked.

## Processes

```text
client (a command, an environment)      plain Node
 └─ supervisor            detached      owns everything below, publishes the discovery record
     ├─ (bootstrap only) two Engine servers, each in its own process group
     └─ host                            Node: runs Packages, serves the API
         └─ watchers service            child of the host
```

A consumer of the served modules is a separate process, started by whoever launches applications, with the BEE Node `packages` adapter. The service does not launch consumers and does not know the loader.

## Packages the toolchain supplies

Besides the packages of the workspace, the host compiles and serves the Beyond-authored packages installed with the toolchain that every workspace may depend on: the development runtime (`@beyond-js/local-2026`, under its provisional name), `@beyond-js/widgets` and the framework adapters (`@beyond-js/react-19-widgets`, `@beyond-js/vue-widgets`, `@beyond-js/svelte-widgets`), each when it is installed ([Installation.supplied](../service/installation.mjs)). They enter the Packages workspace as packages named by their absolute directory, never watched, take their place after the packages of the workspace, which win a name conflict, and appear in the session and in the builds like any module. A project therefore declares them in its dependencies and installs nothing: the service is where a browser and a Node consumer load them from.

The libraries those packages depend on and that are not themselves supplied (React, ReactDOM, Vue, Svelte) are the `runtime.packages` of the session, which a Node consumer resolves from the installation through the loader, so a widget of the workspace and the adapter of the toolchain share one copy of the framework. For a browser, the service compiles any installed package the graph of a preview reaches, at its installed version, from the package that imports it, the supplied packages or the installation ([Delivery.installed](../modules/artifacts/installed.ts)): the public subpath is resolved through its `exports`, compiled with the esbuild packaging path, its bare references kept, its CommonJS shape adapted to named exports, and kept while the installation it was compiled from is unchanged: a name and version do not identify bytes in development, so the real location of the installation and when its manifest was written are part of what the result is kept under, and a package reinstalled under the same version — from another registry, patched or relinked — is compiled again ([tests/identity](../tests/identity/README.md)). Where several directories hold the package, the first that holds the requested version is used; the address of a module names a name and version only, so two different installations of one version cannot both be served. Two subpaths of one package whose graphs share files would each carry a copy of them, and a file that holds state must not be copied: when the graph of one subpath reaches the entry point of another (Svelte's `svelte` reaches `svelte/internal/client`, which its compiled components import), the first is compiled as the carrier of both, from an entry that keeps its own API and republishes the API of the second under names of its own, and the second becomes a facade that renames those back, so a browser holds one runtime ([Sharing](../modules/analysis/pinned/sharing.ts), which the preparation of a package for delivery now uses as well); a subpath whose API the union cannot list, because it re-exports an external module in turn or has a name that is not an identifier, stays on its own, and subpaths that share files without containing one another are not covered. The compiler is the one `BEYOND_ESBUILD_COMPILER` names, or else the `esbuild` installed with Packages; the supervisor sets that variable to `esbuild` for the host when the environment does not, which is also what compiles the supplied runtime, whose manifest selects `env:BEYOND_ESBUILD_COMPILER`.

The compiled-module routes answer every origin (`Access-Control-Allow-Origin: *`), so a page of another origin, such as an existing site that embeds a widget served here, can import modules and read validators. Production output (`env=production&min=true`) is answered only by a module that builds a production conditional, which the esbuild packaging mode does; a module that builds none is refused with `OPTION_UNSUPPORTED`, never answered with its development artifact.

## Context

`Context` decides which directory is the workspace and nothing more: an explicit root exactly; otherwise the nearest ancestor with a `beyond.json` whose declared packages include the package the directory belongs to; otherwise the nearest `package.json` as a standalone package. A package below a workspace that does not declare it is an error, not an adoption. Paths are canonical. Packages, modules and selectors are resolved by Packages inside the host.

## Discovery, reuse and lifetime

A running service is found through a record keyed by the canonical root, the protocol and the installation (Packages' version, form and location). The caller, its arguments and its terminal are not part of the key. A record is a hint: `Connection.validate` asks the live service to describe itself and compares workspace, installation and supervisor before using it. A record whose process is gone is removed; one that leads to something else is discarded and that process is left alone; a service that answers and refuses the client (`401`, `403`) is reported as `SERVICE_ACCESS_REFUSED` and is neither discarded nor duplicated. Looking up and starting happen under a lock directory, so simultaneous commands start one service, and a lock whose holder died is taken over.

Clients attach by holding an event stream open (`GET /attach?kind=owner|session|consumer`). A client that ends or crashes closes it, so no cooperation is needed to notice, and the same stream tells clients that the service is stopping.

| Started with | Ends |
| --- | --- |
| `lifetime: 'owner'` | When the owner detaches, whoever else is attached; they are told. Only the holder of the start token can be the owner. |
| `lifetime: 'attachments'` | Two seconds after the last client detaches. |
| Either | After 30 seconds if nobody claimed it: whoever started it is gone. |

Stopping ends the host, then what the preparation started, then removes the record, and finally the supervisor signals its own process group: the watchers service forks a monitor that outlives a host that was killed. Each start appends the identifiers of the supervisor, the host and every process group to `processes.jsonl` in the service directory. Verify a stopped service with those identifiers and never by command text, because several of these processes rename themselves.

## Endpoints

| Endpoint | Answer |
| --- | --- |
| `/m/...` | The compiled-module API, implemented by the [HTTP routes](../modules/http/routes/index.ts) of Packages over the shared codec |
| `GET /session` | The `beyond-dev-session/1` description: workspace, modules with their paths and package bases, runtime, options |
| `GET /selection?selector=&directory=` | The public module a selector names, the workspace modules it reaches and the ones that do not build |
| `GET /state` | Every public module built, with status and diagnostics, and who is attached. A module is built for Node consumers, or for browsers when it does not declare Node, so a browser-only module is described as what it is and not as one that does not build. Answering it **builds**, so it reads sources on a path of its own beside the watcher; a known defect of that is under [known limits](#known-limits) |
| `GET /attach?kind=` | The attachment stream |

Readiness means the watchers service runs, the workspace was read and the endpoint listens. It does not mean the workspace builds. Sources are watched by Packages. Manifests are not, so the host compares `beyond.json`, `package.json` and `module.json` files when it is asked to resolve or describe, and reloads its workspace when they changed.

## Embedding the service

```js
const service = new Service(context, { headers: { authorization: grant } });
await service.acquire({ lifetime: 'owner', bind: '0.0.0.0', extensions: ['@beyond-js/packages/development'] });
```

- `bind` is the address the host listens on. The default is `127.0.0.1`, because **the service has no authentication of its own**. Another address is only appropriate where something else decides who reaches it. A wildcard bind keeps a loopback origin in the discovery record.
- `extensions` are module specifiers imported in the host. An extension exports `guard(app, context)`, mounted before every route of the service, and/or `setup(app, context)`, mounted after them and before the error handler. `context` is `{ workspace, delivery, settings }`: the first two are the same hosted workspace, which stays valid across manifest reloads; `settings` never carry the start token. An extension that cannot be loaded or fails fails the start.
- `headers` are the access context this client presents to a guarded service.
- A caller that names no `extensions` starts the ones of the `BEYOND_SERVICE_EXTENSIONS` variable, specifiers separated by commas. It is how a person adds the development extension, and with it the [preview](development-contract.md#preview-entry) of the workspace, to the service that a command starts: `BEYOND_SERVICE_EXTENSIONS=@beyond-js/packages/development beyond run`. A caller that names its extensions, such as a Workspace project environment, is not affected.
- The host waits `BEYOND_WATCHERS_TIMEOUT` milliseconds (a whole number; the module's default of 15 s without it) for its watchers child to load its implementation. A deployment on a loaded host, such as the Workspace environment image, sets it: a child that loads slowly is not one that failed, and the default made a Dev Server die at start when the host was busy.
- A client waits `BEYOND_SESSION_TIMEOUT` milliseconds (a whole number; `Connection.TIMEOUT`, 5 s, without it) for the first session description of a service, and a deployment on a loaded host sets it for the same reason. A service that does not answer in time is reported as `SERVICE_NOT_ANSWERING` (`TimeoutError` from the validation, `ServiceError` with that code and the service log from `acquire`), never as a service that described itself wrongly, and its discovery record is kept: inside a saturated container the answer crossed the default although the service was healthy, and the environment exited with `SERVICE_START_FAILED` while its own log ended at the ready line.

These options describe a service that the call starts and are ignored when a running one is reused.

## Engine-independent distribution: what exists and what remains

| | |
| --- | --- |
| Exists | Engine's distribution build for npm (`beyond build --pkg <name> --distribution npm`), the mechanism that produced the published Beyond utilities with their per-module outputs and `exports` maps. The `Implementation` seam and the compiled path of this service, which starts the host as a plain Node process when the manifest exports the compiled modules. |
| Executed | The npm build was run once against the current source of Packages, outside the checkout, on 2026-09-18 with Engine 1.4.1 and Node 22.21.1. It began emitting per-module outputs (`.mjs`, `.cjs.js`, `.d.ts`), reported invalid declarations for 5 of the first 10 modules, starting with the legacy modules under `modules/_older-to-be-refactored-or-delete`, and then a worker ended with `JavaScript heap out of memory` and the build did not finish. No distribution was produced. The selection between the two forms is unit-tested; the compiled path of the service has never run, because there is nothing compiled to run it against. |
| Remains | Make the build complete: exclude or repair the modules whose declarations fail and resolve the memory exhaustion. Decide the distribution's manifest (compiled `exports` beside `./service`, files, runtime dependencies) and produce it. Give the compiled distribution a watchers service that needs no compilation, which the published `@beyond-js/watchers` 1.0.7 does not contain. Then accept it on its own terms: install the compiled archive into an empty directory **without** `beyond` and `@beyond-js/packages-bootstrap`, and run the command line's acceptance suite against it. Self-compilation of Packages by Packages and registry publication are further, separate steps. |

Installing today's archives proves relocation and an automated bootstrap. It is not evidence of a compiled release.

## Known limits

- Source read/write, revisions, events and reconnection belong to the [development contract](development-contract.md) and are not implemented by this service; it is the artifact, selection, state and lifecycle slice. A host adds them by naming the public module `@beyond-js/packages/development` in `extensions`.
- The service itself pushes nothing to consumers. With the development extension it announces builds on `/events`, and the updates of composed modules are served by the provisional `/u/` route of the HTTP routes; a consumer that registers the service in the development runtime applies them while it runs, which [the unified-runtime validation](../tests/unified-runtime/README.md) executes for Node consumers. Without that runtime, a consumer started after an edit loads rebuilt code; that is not HMR. The session describes Node modules only. The builds of the development extension name the platform of each artifact, and its preview document registers the service in a development runtime that the workspace contains, which [the preview validation](../tests/preview/README.md) executes in a browser; a workspace without that runtime, which is every project that uses the published Kernel, is rebuilt on save and shown on reload.
- One defect of an installed utility is contained in [processors.mjs](../service/host/processors.mjs): the slow-processor warning of `@beyond-js/dynamic-processor` 1.0.8 throws. User impact without the containment: the service would end whenever a processor took more than five seconds. The utility's source is repaired; the containment stays until a published version is depended on.
- A write that lands while `GET /state` is being answered is sometimes never built. Answering that route builds every published module, so it reads the sources on a path of its own beside the watcher, and a source saved in that window can stay unbuilt until an unrelated later edit of the same file. User impact: an editor or a Workspace environment polls the state while a person is typing, so a save is silently ignored and the module keeps the diagnostic of the previous one. Measured against an installation, breaking a Vue component, waiting for the failed build and writing the original bytes back, each round in a fresh service and workspace: 4 of 6, 5 of 6 and 7 of 8 restores were announced; the ones that arrive take about 1.1 s and the ones that do not never arrive. The same sequence with nothing asked of the service between the two writes is 12 of 12, and with a 400 ms pause after the failed build before the state is first asked for, 8 of 8, which is what localizes it to this route rather than to the watcher. A TypeScript source, a Svelte component and a stylesheet did not show it in the same harness (5 of 5, 6 of 6, 5 of 5). What produced it is not yet named: the two candidates are the cached content of a dynamic file against the announcement of its change, and the internal-module registry of the Vue processor, which on a parse failure leaves `compiled.modules` empty and so never updates the outputs of the generated modules. The command line's `web` acceptance fails on it, and the two steps after it are its cascade.
- The host must not be given an IPC channel: the implementation's IPC utility takes a process that has one for a child of its own router.
- Validated on macOS; process groups are POSIX, and Windows was not exercised.

## Development

```sh
node --test "service/test/*.test.mjs"      # context and implementation selection
(cd bootstrap && npm test)                 # process groups and ports
```

In a checkout, the service finds the bootstrap through `node_modules/@beyond-js/packages-bootstrap`, linked to `bootstrap/`. Behavior is accepted through the command line's acceptance suite, against an installation and never against a checkout.
