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
| `GET /state` | Every public module built, with status and diagnostics, and who is attached |
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

These options describe a service that the call starts and are ignored when a running one is reused.

## Engine-independent distribution: what exists and what remains

| | |
| --- | --- |
| Exists | Engine's distribution build for npm (`beyond build --pkg <name> --distribution npm`), the mechanism that produced the published Beyond utilities with their per-module outputs and `exports` maps. The `Implementation` seam and the compiled path of this service, which starts the host as a plain Node process when the manifest exports the compiled modules. |
| Executed | The npm build was run once against the current source of Packages, outside the checkout, on 2026-09-18 with Engine 1.4.1 and Node 22.21.1. It began emitting per-module outputs (`.mjs`, `.cjs.js`, `.d.ts`), reported invalid declarations for 5 of the first 10 modules, starting with the legacy modules under `modules/_older-to-be-refactored-or-delete`, and then a worker ended with `JavaScript heap out of memory` and the build did not finish. No distribution was produced. The selection between the two forms is unit-tested; the compiled path of the service has never run, because there is nothing compiled to run it against. |
| Remains | Make the build complete: exclude or repair the modules whose declarations fail and resolve the memory exhaustion. Decide the distribution's manifest (compiled `exports` beside `./service`, files, runtime dependencies) and produce it. Give the compiled distribution a watchers service that needs no compilation, which the published `@beyond-js/watchers` 1.0.7 does not contain. Then accept it on its own terms: install the compiled archive into an empty directory **without** `beyond` and `@beyond-js/packages-bootstrap`, and run the command line's acceptance suite against it. Self-compilation of Packages by Packages and registry publication are further, separate steps. |

Installing today's archives proves relocation and an automated bootstrap. It is not evidence of a compiled release.

## Known limits

- Source read/write, revisions, events and reconnection belong to the [Dev Server/File API contract](development-server.md#synchronization-and-durability-contract) and are not implemented by this service; it is the artifact, selection, state and lifecycle slice, extended by hosts through `extensions`.
- Updates are not pushed to consumers and patches are not served over HTTP. A consumer started after an edit loads rebuilt code; that is not HMR.
- One defect of an installed utility is contained in [processors.mjs](../service/host/processors.mjs): the slow-processor warning of `@beyond-js/dynamic-processor` 1.0.8 throws. User impact without the containment: the service would end whenever a processor took more than five seconds. The utility's source is repaired; the containment stays until a published version is depended on.
- The host must not be given an IPC channel: the implementation's IPC utility takes a process that has one for a child of its own router.
- Validated on macOS; process groups are POSIX, and Windows was not exercised.

## Development

```sh
node --test "service/test/*.test.mjs"      # context and implementation selection
(cd bootstrap && npm test)                 # process groups and ports
```

In a checkout, the service finds the bootstrap through `node_modules/@beyond-js/packages-bootstrap`, linked to `bootstrap/`. Behavior is accepted through the command line's acceptance suite, against an installation and never against a checkout.
