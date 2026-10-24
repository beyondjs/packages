# Launching execution targets

The development service can start the backend execution targets a workspace declares and follow them: whether the process lives, whether it said it is ready, what it writes, and how it ended. This is the `beyond-launches/1` contract, implemented by the launches feature of the host ([service/host/launches/](../service/host/launches/index.mjs)). It is what the Packages interface uses to offer **Launch**, **Stop** and the output of a backend target; the command line's `beyond run --target` runs a target in its own terminal instead and does not use these routes.

Execution targets are declared in the `applications` branch of the workspace's `beyond.json` and resolved by the catalog of applications of the development extension (`@beyond-js/packages/development`, `beyond-applications/1`). The engineering design of both, and of the interface that uses them, is the Beyond Suite's `docs/products/packages/developer-journey.md`.

## Enabled only where it is given

The feature is opt-in. A service launches targets only when it was started with the `launch` setting:

```js
await service.acquire({
	lifetime: 'owner',
	extensions: ['@beyond-js/packages/development'],
	pairing: true,
	launch: { node: { register, launcher }, deno: { executable } }   // deno is optional
});
```

- `node.register` is the BEE Node registration (`@beyond-js/bee-node/register`) and `node.launcher` the command line's launcher (`src/launcher.mjs` of `@beyond-js/cli`), both absolute paths or `file:` URLs of the installation. The command line's `beyond run` gives them; nothing else does.
- `deno.executable` is a Deno 2 executable. Without it, a Deno target uses the `launch.deno` setting of the service's settings, else `BEYOND_DENO`, read at every launch.
- A service started without the setting — by `beyond test`, `beyond install`, `beyond run <module>`, the Conduict Machine Manager, CDN's embedded compiler or any other import of Packages — mounts no launch route (`404 NOT_FOUND`), claims no `launch` capability in `GET /session` and can start no process. Its settings offer no Deno executable either: `launch.deno` is not editable there ([settings](settings.md)), so no executable is ever run to check one.
- A setting without both paths fails the start of the service, and so does a service that does not tell its clients apart: launching needs a service that pairs browsers or verifies delegated grants (`BEYOND_AUTHORITY`). A loopback service that does neither, whose routes a local consumer and, for reads, any process of the machine reach, refuses to start with the setting.
- The setting describes a service this call starts. `Service.acquire` does not reuse a running service that does not launch as if it did: one that ends with its clients is replaced, and any other is refused with `SERVICE_LAUNCH_MISSING` ([the service guide](service.md#embedding-the-service)).

On a service that pairs, the routes are reached by paired pages and local tools with the service's local credential, as every route of the API listener that is not a compiled module; a local consumer, such as a launched process, and a page of another site reach none of them.

## Routes

| Route | Answer |
| --- | --- |
| `GET /launches` | `200 {protocol: 'beyond-launches/1', launches, listeners}`: the launches, the newest first, and the declared backend targets whose port something listens on now ([what is already running](#what-is-already-running)) |
| `POST /launches {application, target}` with `Idempotency-Key` | `202 {launch}` with `Location: /launches/<id>`; the same key for the same target answers the same launch (`200`) |
| `GET /launches/:id` | `200 {launch}` |
| `POST /launches/:id/stop` | `202 {launch}` |
| `GET /launches/:id/output?after=<seq>` | `200 {lines: [{seq, stream, text, time}], next, dropped}` |

Bodies are JSON (`Content-Type: application/json`, at most 4096 bytes); every answer is `no-store`; refusals use the error envelope of the service, `{error: {code, message, details?}}`.

| Refusal | Status | When |
| --- | --- | --- |
| `IDEMPOTENCY_KEY_REQUIRED`, `IDEMPOTENCY_KEY_INVALID` | 400 | A launch request without a request identifier, or with one that is not 8 to 128 letters, digits, `_`, `.`, `:` or `-` |
| `BODY_INVALID`, `CONTENT_TYPE_UNSUPPORTED`, `BODY_TOO_LARGE`, `OPTION_INVALID` | 400, 415, 413, 400 | A body that does not name a target by its identifiers, one that is not JSON or too large, an `after` that is not a whole number |
| `APPLICATION_NOT_FOUND`, `TARGET_NOT_FOUND` | 404 | The catalog declares no such application or target |
| `LAUNCH_NOT_FOUND` | 404 | This service has no launch with that identifier |
| `LAUNCH_RUNNING` | 409 | A launch of the target lives; `details.launch` is that launch |
| `LAUNCH_ENDED` | 409 | The launch to stop already ended; `details.launch` is its record |
| `TARGET_NOT_LAUNCHABLE` | 422 | `details.reason`: `TARGET_FRONTEND` (a frontend target is opened as a document, its preview, never launched), the reason the catalog gives (`TARGET_PACKAGE_NOT_FOUND`, `TARGET_ENTRY_NOT_FOUND`, `TARGET_AMBIGUOUS`, `TARGET_ENVIRONMENT_UNSUPPORTED`, …), `TARGET_KIND_INVALID`, `TARGET_ENTRY_NOT_FOUND`, `TARGET_RUNTIME_UNSUPPORTED` (a runtime other than `node` and `deno`), `LAUNCH_CONSUMER_REFUSED` (a launched process could not read this service, [below](#limits)), `DENO_NOT_CONFIGURED`, `DENO_INVALID` (the configured executable is not an absolute path to a file the service may execute that answers `--version` as Deno 2 within its bound, checked at every launch), or `APPLICATIONS_UNAVAILABLE` (a service without the development extension, which holds the catalog) |
| `IDEMPOTENCY_KEY_REUSED` | 422 | The request identifier already named a launch of another target |
| `UNAVAILABLE` | 503 | The service does not listen yet, it is ending, or the catalog did not resolve the target within its bound; nothing was launched |

**One request, one launch.** A reload of the interface or a lost answer repeats a request with the same identifier and receives the launch it created, whatever its state, while that launch is kept: a second process is never started for it. A request that was refused leaves its identifier free, so the same request is decided again once its cause is corrected. Requests for one target are decided one after the other, so two requests at once never start two processes.

## A launch

```json
{
	"id": "lch_6d37d41da5ce9f2bcc64f06e",
	"application": "composition",
	"target": "api",
	"specifier": "@testbed/composition-api/server",
	"environment": "node",
	"state": "ready",
	"pid": 15298,
	"started": "2026-10-11T16:54:56.477Z",
	"ready": "2026-10-11T16:54:56.520Z",
	"readiness": "observed"
}
```

| `state` | Meaning |
| --- | --- |
| `starting` | The process is being created |
| `running` | The process lives; that is all that is known of it |
| `ready` | The readiness text the target declares (`readiness.output`) appeared in its standard output or error |
| `stopping` | A stop was asked: `SIGTERM` to its process group, `SIGKILL` once `BEYOND_LAUNCH_STOP` passed |
| `exited` | It ended after a stop, or by itself with code 0 (and, when it declares a readiness, after it was observed); `exit: {code, signal}` |
| `failed` | It could not be started (`reason.code: LAUNCH_SPAWN_FAILED`), its port was taken (`LAUNCH_REFUSED`, no process started), or it ended by itself otherwise (`LAUNCH_EXITED`, with `reason.tail`, the last lines of its output); `failure` says why in a person's words |

**Why it failed.** A launch that failed because its port was taken, or whose process ended by itself, carries `failure: {code, message, port?, address?, specifier?}`, read from its output and its exit ([Failure](../service/host/launches/failure.mjs)); the raw output stays in `reason.tail` and the output route:

| `failure.code` | When | `message` |
| --- | --- | --- |
| `PORT_IN_USE` | `EADDRINUSE` in its output, with `port` and `address`; or its port accepted connections just before the start | `Port 5231 is already in use` |
| `PERMISSION_DENIED` | `EACCES` listening on a port | `Permission denied to listen on port 80` |
| `MODULE_MISSING` | `ERR_MODULE_NOT_FOUND`, "Cannot find package" or "Cannot find module", with `specifier` | `express is imported by /work/api/server.js but is not a dependency of @app/api: add it to its dependencies and run beyond install` |
| `SYNTAX` | A `SyntaxError` | `Syntax error: …` |
| `EXITED` | Anything else | `The process ended by itself with code 1`, or the signal that ended it |

A launch whose port is known also says it (`port`).

`readiness` is `observed`, `waiting` or `undeclared`. A process that lives is never said to be ready without its declared readiness, and nothing here says that it serves: whether it answers is observed by whoever asks it. `diagnostics`, present only when there are some, is what the preparation of its command said: `LAUNCH_VARIABLE_IGNORED` with the `name` of each reserved variable the target's settings hold and that was not given ([below](#how-a-target-runs)).

**Output.** The last 1000 lines of both streams are kept, each numbered (`seq`), with its stream and the time it arrived. A line is what a terminal shows: what follows its last carriage return, without control sequences, cut at 2000 characters with an ellipsis. A reader passes the number of the last line it has as `after`; `next` is the number to pass next time and `dropped` how many lines after `after` are no longer kept.

**Events.** On the event stream of the development extension (`GET /events`): `launch.changed {launch}` at every change of state, and `launch.output {launch, next}` when lines arrived, at most four times a second. Both carry the whole record of the launch. `launch.output` is transient: it reaches the subscribers that are open, in order with the other events, and is never kept in the replayed log, so a chatty process never pushes the source events out of it (`Development.TRANSIENT`). A client that reconnects, with its cursor or after a `resync`, reads the lines it missed with `GET /launches/:id/output?after=<the last line it has>`, and `launch.changed`, which is kept, is replayed.

## What is already running

A target's port is the `PORT` of the variables the settings keep for it (`targets.<application>.<target>.environment`), else the `port` its declaration names; at a launch, the `PORT` of the environment the process is given counts too (the service's own, when the settings set none). Just before a process is started, a connection to that port on `127.0.0.1` and `::1` is tried for at most 500 ms: when one is accepted, the launch fails at once with `failure.code: PORT_IN_USE` and no process is started, so an interface offers another port (the target's `PORT` setting) instead of reading a stack.

`GET /launches` adds `listeners`: for every declared backend target whose port is known and accepts a connection now, `{application, target, port, address, launch?}`, where `launch` names the live launch of this service that holds it. A listener without `launch` was started outside this service: an interface says it runs, started outside Packages, and offers no stop. At most 64 targets are checked, in parallel, within the same bound.

## How a target runs

The target is resolved by the catalog: the specifier a launch imports (`launch.specifier`: the public specifier of its entry, or the versioned one the catalog resolved, `entry.vspecifier`, when several local versions of its package publish it, which is how the session of the service names it, so the version its `selection` names is the one that runs), its runtime and its readiness. Its process runs in the workspace root, in a process group of its own, with the environment of the service without the service's own settings and credentials (`BEYOND_HOST_OPTIONS`, `BEYOND_SERVICE_OPTIONS`, `BEYOND_AUTHORITY`, `BEYOND_ENVIRONMENT`, `BEYOND_TRUST_LOOPBACK` and any `BEYOND_*` variable that names a token, secret, credential, password or key), and with the variables the settings feature keeps for the target (`targets.<application>.<target>.environment`), which never replace the loader configuration: a reserved name (`LD_*`, `DYLD_*`, `NODE_OPTIONS`, `NODE_PATH`, `BEE_*`, `BEYOND_*`, `DENO_*`), which a change of the settings refuses and a settings file may still hold, is not given, and the launch says so in its `diagnostics`.

- **Node** runs as the command line runs a module: `node --enable-source-maps --import <stacks> --import <register> <launcher> <specifier>`, with `BEE_URL` the API origin of the service, `BEE_ADAPTER=packages` and `BEE_IMPORT_MAP` empty, so the bootstrap's own loader configuration never reaches it. `<stacks>` is `@beyond-js/packages/service/stacks/register` ([below](#uncaught-errors)).

### Uncaught errors

A Node target runs with source maps applied to its stacks and with `@beyond-js/packages/service/stacks/register` imported first ([service/stacks](../service/stacks/index.mjs)). An uncaught error is then printed without the frames of the toolchain (Node's internals, `@beyond-js/kernel`, BEE Node, the bootstrap, and the directories of the registration and the launcher, which the launch names in `BEYOND_STACKS_HIDDEN`), and the process ends with code 1; a stack whose frames are all the toolchain's is printed whole. A package that cannot be found is said first as what to do: `<specifier> is imported by <file> but is not a dependency of <package>: add it to its dependencies and run beyond install`, the package being the nearest `package.json` above the importing file that names one; a missing relative module is said as `<path>, imported by <file>, does not exist`. A program that listens to `uncaughtException` itself keeps its own behavior. The command line can do the same for `beyond run ./main` with `node --enable-source-maps --import @beyond-js/packages/service/stacks/register …`, and `Stacks` (`@beyond-js/packages/service/stacks`) formats an error the same way.
- **Deno** runs `deno run --no-config --no-lock --allow-net --allow-import --allow-env --reload=<origin>/ --import-map=<origin>/importmap.json?target=node&format=esm` over [deno.mjs](../service/host/launches/deno.mjs), a module of the feature that imports the specifier. `--no-config` and `--no-lock` keep the workspace's Deno configuration and lock file out of it; `--reload=<origin>/` fetches the service's modules again at every launch, so a rebuilt module is never taken from Deno's cache, which is `<root>/.beyond/launches/deno` (`DENO_DIR`, in the state directory, whose `.gitignore` the launch writes when it is missing) and keeps what other origins delivered. The executable (the `launch` setting's, else `launch.deno`, else `BEYOND_DENO`) is checked at every launch as a change of `launch.deno` is: an absolute path to a file the service may execute that answers `--version` as Deno 2 within 5 seconds, run with only `PATH`, `HOME` and `NO_COLOR` (`DENO_INVALID` otherwise, nothing created). The target imports what the service's Node import map names: the public modules of the workspace and of the supplied packages, such as the development runtime of composed modules. Installed packages are not in that map, so a Deno target that imports one fails to load it; nor is a versioned specifier, so a Deno target whose package several local versions publish fails to load the entry its launch imports.

## Bounds and the end of the service

| Wait | Bound | Then |
| --- | --- | --- |
| A stop | `BEYOND_LAUNCH_STOP`, 10000 ms | `SIGKILL` to what remains of the process group |
| The resolution of a target by the catalog and the preparation of its command | `BEYOND_WORKSPACE_TIMEOUT` (120000 ms) and 5 s more, since the catalog may wait for a reload of the workspace | `503 UNAVAILABLE`; nothing was launched, and the target's later requests are decided |
| The rest of the output after a process exited | 200 ms | The launch ends with what was read; lines that arrive later, from a process it left behind, are still kept |
| The end of the service | 2500 ms (or `BEYOND_LAUNCH_STOP` when shorter), then 1000 ms after `SIGKILL` | The host's own end is bounded to 6 s |

Launches end with the service: when it ends, the feature first closes its registry, so a request decided afterwards, one whose target the catalog resolves only then included, is answered `503 UNAVAILABLE` (the service is ending) and starts no process; then every live launch receives `SIGTERM` and then `SIGKILL`. A host process that exits without time for that sends `SIGKILL` to their groups as it exits: that handler stays registered until every process the feature may signal ended, or until the host exits. Only launches of this service are listed, read or stopped, and a signal only ever goes to a process group the feature created while that group still holds a process.

The live launches and the last 20 ended ones are kept in memory with their output and request identifiers; nothing of them is written, so a service that started again has no launches.

## Limits

- A process the target started in its group and left running after the target's own process ended by itself is not stopped: the feature signals the group of a launch only while it lives or after a stop was asked.
- A host killed with `SIGKILL` cannot end its launches. Their identifiers are not written to the service's `processes.jsonl`, so they are not part of what verifies that a stopped service left nothing behind.
- A running service is never reused as if it launched: a `beyond run` that finds a server started by another command without the setting (`beyond run <module>`, `beyond run --target`) replaces it when that server ends by itself (it ends with its clients), and is otherwise refused with `SERVICE_LAUNCH_MISSING`, which names what to do ([the service guide](service.md#embedding-the-service)).
- A launched process presents no credential and no grant, so it reads the service only as a local consumer ([portable connections](portable.md)). Behind a public origin (`beyond run --public-origin`), on a non-loopback address, or where delegated grants let no loopback request through (`BEYOND_TRUST_LOOPBACK` unset), nobody is a local consumer: a launch there is refused before any process starts (`422 TARGET_NOT_LAUNCHABLE`, `LAUNCH_CONSUMER_REFUSED`). The catalog, which does not know how the service is reached, still answers `launch.supported: true` for the target; the `launch` capability is still claimed, so a `beyond run` that asks for launches reuses the service.
- A Deno target whose package several local versions publish fails to load its entry: the Node import map Deno loads with has no entry for a versioned specifier.
- Process groups are POSIX; on Windows a stop reaches the launched process alone. Validated on macOS.
- Readiness is a text in the output; a target that declares none is never said to be ready.

## Validation

```sh
node --test "service/test/launches*.test.mjs"     # the feature with stand-ins for the catalog, the registration, the launcher and Deno
node --test service/test/stacks.test.mjs          # uncaught errors and missing packages, printed as a launched target prints them
node --test tests/launches/service.test.mjs        # the real service of this checkout (PKG-A10, a Node target end to end)
node --test tests/launches/versions.test.mjs       # the real service with two local versions of the target's package
BEYOND_DENO=<Deno 2 executable> node --test tests/launches/deno.test.mjs   # a Deno target end to end; skipped without it
```

[tests/launches/](../tests/launches/README.md) describes what each run establishes, its prerequisites and its fixtures. The command line's `targets` acceptance group runs the launch from the server of an installed `beyond run`.
