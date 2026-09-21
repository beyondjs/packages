# Development contract: files, events and builds

`beyond-dev-files/1` is the versioned contract of the Dev Server's source operations, change events and build correlation. Packages owns it, as described in [Dev Server and File API](development-server.md). This guide explains the rules; the machine-readable parts live in `contracts/development`:

| File | Content |
| --- | --- |
| `schema.json` | JSON Schema 2020-12 definitions: `path`, `revision`, `cursor`, `tree`, `mutation`, `result`, `batch`, `event`, `build`, `diagnostic`, `selection`, `preview` |
| `fixtures/valid`, `fixtures/invalid` | Documents named `<definition>.<case>.json` that must pass or fail their definition |
| `scenarios.json` | Behavior every implementation must reproduce: conflicts, external writes, replay, gaps, stale builds, access, the development selection and the preview entry |

**Status: implemented by the public module `@beyond-js/packages/development`** (`modules/development`), with the limits listed under [Implementation and limits](#implementation-and-limits). The hosting development service mounts it as an extension; nothing in it compiles, resolves or stores users and roles.

## Identities

A **path** is relative to the served root, uses `/`, and has no empty, `.` or `..` segment. It names a file. It never names a public module: module identity stays with `Identity`, `ModulePath` and `Selector`, and a file does not become a public module by existing.

A **revision** is `sha256-<hex>` over the file bytes. It is the same value, unquoted, as the HTTP entity tag of the file. Directories have no revision. A revision identifies content, so writing identical bytes yields the same revision and announces no change.

A **cursor** is `<epoch>:<seq>`. `seq` orders every event of one epoch. The epoch changes whenever the server cannot vouch for continuity: process start, watcher failure, or an event log that dropped entries a subscriber might still need.

## Reading

`tree` answers with entries and the cursor they are exact for; events after that cursor apply on top of it, which makes every tree a snapshot boundary. `scanned: true` means disk was re-read for this answer. Polling and manual refresh request a scan, so a change the watcher never delivered is still found; it is then announced with origin `scan`.

## Mutations and conflicts

Every mutation states what the writer believes is on disk: `expected` is a revision, or `absent` for a creation. There is no unconditional write. The server compares `expected` with the bytes on disk at the mutation boundary, not with a watcher-fed index, because agents, Git and other tools write without passing through this API and no API lock can serialize them.

| Outcome | Meaning |
| --- | --- |
| `completed` | The bytes are durably written; `revision` and `cursor` identify the result |
| `conflict` | Nothing changed. `conflict.expected` and `conflict.current` let the client compare; `current: "absent"` means the file is gone; `target` names an existing rename destination |
| `failed` | Nothing is promised; `error` explains |
| `skipped` | A batch stopped before this mutation |

Writes replace the file atomically (temporary file and rename in the same directory), so a reader or a crash never observes a missing or half-written file. A rename never overwrites its destination. Deleting or renaming requires a revision: a file that is already gone is a conflict, not a silent success.

A **batch** is ordered and not atomic. It stops at the first mutation that does not complete and reports `partial`: earlier mutations stay on disk, later ones are `skipped`. A `batch.completed` event marks the end of its changes so that a build does not snapshot the middle of a multi-file edit.

## Events

Events are delivered in cursor order. `file.*` events carry `origin`:

| Origin | Source | Knows the author |
| --- | --- | --- |
| `api` | A mutation of this API; `actor` is copied from the verified grant, including the task of an agent | Yes |
| `external` | The watcher observed a write that bypassed the API | No |
| `scan` | A comparison of disk with the index found it | No, and not the time either |

An `api` mutation that the watcher also observes is announced once. An external move is announced as `file.deleted` plus `file.created`, because a watcher cannot prove identity across paths; `file.renamed` exists only with origin `api`.

A subscriber presents the last cursor it processed. Within the same epoch and the retained log it receives exactly the later events; a client ignores any event whose `seq` is not greater than the last one it applied. Otherwise the first event is `resync` with reason `EPOCH`, `GAP`, `OVERFLOW` or `WATCHER`, and the client reads a scanned tree and reconciles against it. The server never claims that watcher delivery is lossless.

Editor buffers are client state. The contract gives a client what it needs to keep a dirty buffer safe: the base revision it loaded, a change event or conflict result carrying the current revision, and the content to compare. A client never discards a dirty buffer because an event arrived.

## Builds

A build records `input`, the cursor it read its sources at. `build.started` and `build.ended` carry the whole build document. A build that ends after a newer change to one of its input files ends `superseded` and is never reported as current. Diagnostics carry the file, range and the revision that was compiled, so a client can tell a diagnostic about old text from one about the text on screen.

A module is built for every platform it declares, `node` and `web`, and `modules` lists it once for each with its `platform` and the hash of that artifact. A Node consumer and a browser preview each apply the artifact of their own platform, so one hash per module would announce to one of them an update that the update route then refuses. A platform that a module does not declare is not a failure: it is left out. A module that declares neither is listed once, `invalid`, without a platform. A source error that every platform meets is reported once.

Saving a file, completing a build, delivering an artifact and applying an update in a runtime are four different facts. This contract reports the first two. Artifact delivery is the compiled-module contract; applying an update is reported by the runtime.

## Development selection

The **selection** says which packages and public modules of the workspace are in development. It is what the preview reads to decide where each module comes from: a selected module is served by this environment, and everything else comes from the CDN.

Only a request that replaces the selection changes it. Reading, opening, editing, creating or building a file never does. Until somebody selects, `explicit` is `false` and every package of the workspace is in development, because a package that was never published has no other place to come from. A replacement names packages, public modules or both; a name the workspace does not declare is refused with `SELECTION_INVALID` and its `unknown` list, and nothing changes. A selected name whose package later disappears, for example with a branch change, selects nothing, is reported in `unknown` and is kept. Every change is announced as `selection.changed` with the new document. A document that is already open keeps the import map it was loaded with.

The selection is state of the working copy, not source. It is kept in `.beyond/development/selection.json` under the served root, which is the durable volume of a project environment, so it survives a new container, while the home of the service is disposable. The `.beyond` directory ignores itself for Git, is never listed, watched or announced, and a path into it is `PATH_FORBIDDEN` like the repository internals, so no file operation can change the selection.

## Preview entry

`GET /preview/` answers the entry document of the application of the workspace: an import map and one module script that imports the entry module. Importing it runs its top-level code once, which is what executing a public module means; no exported function is called. `GET /preview/entry.json` is the same information as a `preview` document, for a client that shows where each module comes from.

| Module | Address |
| --- | --- |
| In development (selected) | `../m/<package>@<version>/modules/<subpath>?<development browser options>`, relative to the document |
| A workspace package that is not selected | The CDN origin, the same path, the version in its `package.json`, the published defaults of the options |
| A package the workspace does not contain | The CDN origin at its **resolved** version: the one installed for the importing package, or a declared dependency that is an exact version. The runtime the artifacts import resolves from the installation of the service, because a project does not declare it |
| Anything without an exact version or without a CDN origin | No address: `source: "unresolved"` with the reason, a `PREVIEW_VERSION_UNRESOLVED` or `PREVIEW_CDN_UNSET` diagnostic, and no import map entry |

The CDN origin is configured with `BEYOND_CDN_ORIGIN` in the environment of the service. When it is not set the description says so in `cdn.reason`; an address is never invented. A value that is not an http or https origin fails the start of the service. The paths and queries are written by the codec of the compiled-module contract, which makes them the same resource on both origins.

Every address of this environment is **relative to the document**, and the document names neither the origin of the service nor any credential. That is what lets a Workspace administration publish a preview behind an authenticating proxy under a path prefix: the proxy adds the `Authorization` grant to the document, module, update and event requests, and the browser never holds it. A visitor grant needs `artifacts.read` and `events.subscribe` only: nothing a preview page loads reads the session description, which describes the whole workspace and its installation. `GET /preview` redirects to `preview/`, relative as well. The document asks for no icon and sends no referrer, because a visitor link may carry its authorization in the path and the CDN is another origin.

The entry module is named with `?entry=<public specifier>`. Without it, the entry is the only public module that is built for browsers and that no other public module of the workspace imports; the modules of a runtime package are not applications. Several candidates, or none, answer `409 PREVIEW_ENTRY_REQUIRED` with the candidates and the diagnostics of the ones that do not build. While a module does not build, what it imports is unknown, so the entry that was unambiguous before the error stays the entry. Compiler and dependency diagnostics of the graph are part of the description, and the document logs them to the console of the page.

**Updates.** The Dev Server applies nothing to a page: the runtime does. When the runtime the artifacts are assembled against publishes a `main` module — a workspace package that contains it, or else the runtime package installed with the service, whose manifest exports `./main` — the document imports that coordinator and calls `local.register({ origin, options, session })` with the base of the preview before it imports the application, and `updates.runtime` names it. A coordinator the workspace does not contain is addressed like any module that is not in development: on the CDN, at the version the runtime resolves to. This is a provisional convention, like the `/u/` route.

`updates.session` is what the runtime needs of the session to apply updates, and the document gives it to the runtime so that it never requests `/session`: the options of the modules in development and, by specifier, each of them as `{package, vspecifier, path}`. Every one of those modules is already addressed in the import map the visitor received, and nothing else is included — no workspace root, installation, process or filesystem location. When the runtime has no coordinator, which is the case of the published Kernel, `updates.reason` says that nothing applies updates to the running page: new code then appears when the document is loaded again, which is a reload and is never reported as an update.

## Access

In a Workspace project environment every route, including artifact and event routes, requires a `beyond-dev-grant/1` bearer grant signed by the central administration. The Dev Server holds the authority's public keys, its own environment identifier and the latest signed revocation list. It holds no users, teams or roles.

| Capability | Allows |
| --- | --- |
| `session.read` | Session description |
| `files.read` | Tree and content |
| `files.write` | Mutations and batches |
| `events.subscribe` | The event stream |
| `inspect.read` | Package, module and dependency inspection, and reading the development selection |
| `build.control` | Requesting and cancelling builds, and replacing the development selection: it decides what this environment builds and serves for development, it is not a source write, and a viewer does not hold it |
| `process.control` | Starting and stopping development processes |
| `artifacts.read` | Compiled modules and their updates (`/m/`, `/u/`), and the preview entry, for a preview or a runtime |
| `repository.read`, `repository.write` | Git state, and commit or push |

A refusal is `401` with `GRANT_MALFORMED`, `GRANT_KEY`, `GRANT_SIGNATURE`, `GRANT_ISSUER`, `GRANT_AUDIENCE`, `GRANT_EXPIRED` or `GRANT_REVOKED`, or `403` with `GRANT_CAPABILITY`. Expiry and revocation also end open event streams with `access.ended`. A subscriber whose grant lacks `files.read` receives no `file.*` or `batch.*` event: they name source files and who changed them, and a preview visitor subscribes only to learn about builds. The standalone command-line service keeps its loopback binding and owner token; delegated access is the mode of a Workspace environment, not a new requirement of the standalone tool.

## HTTP mapping

The mapping uses standard preconditions so that the existing entity-tag helper and HTTP caches behave correctly. Paths are percent-encoded per segment.

| Operation | Request | Success | Refusals |
| --- | --- | --- | --- |
| Tree | `GET /files/tree?path=&depth=&scan=` | `200` tree | `404 FILE_NOT_FOUND` |
| Read | `GET /files/content/<path>` | `200` bytes, `ETag: "<revision>"`, `Beyond-Cursor`; `304` with `If-None-Match` | `404 FILE_NOT_FOUND` |
| Create or edit | `PUT /files/content/<path>` with `If-None-Match: *` or `If-Match: "<revision>"` | `200` result | `409 FILE_CONFLICT` with the result, `428 PRECONDITION_REQUIRED`, `413 FILE_TOO_LARGE` |
| Delete | `DELETE /files/content/<path>` with `If-Match` | `200` result | `409`, `428` |
| Rename, batch | `POST /files/operations` with `{mutations: […]}` | `200` batch | `400 PATH_INVALID`, `403 PATH_FORBIDDEN` |
| Events | `GET /events?cursor=` or `Last-Event-ID`, `text/event-stream`, `id:` is the cursor | stream | `400 CURSOR_INVALID` |
| Builds | `POST /builds`, `GET /builds/<id>`, `POST /builds/<id>/cancel` | build | `404` |
| Selection | `GET /development/selection`; `PUT` with `{packages?, modules?}`; `DELETE` forgets it | `200` selection | `400 SELECTION_INVALID` |
| Preview | `GET /preview/?entry=`, `GET /preview/entry.json?entry=`; `GET /preview` redirects with `308` | `200` HTML, `200` preview | `404 PREVIEW_ENTRY_NOT_FOUND`, `409 PREVIEW_ENTRY_REQUIRED` |
| Revocations | `PUT /access/revocations` with the signed list as body | `204` | `401`, `409 REVOCATIONS_STALE` |

`PATH_FORBIDDEN` covers a path that resolves outside the root through a symbolic link, the repository's internal `.git` directory and the `.beyond` state directory of the service. The revocation route needs no bearer: the list is self-authenticating and ordered.

## Implementation and limits

`Development` composes the collaborators: `Files` (root rules, revision index, mutations, disk observer), `Log` (epochs, cursors, replay), `Builds` (input correlation over the host's delivery facade), `Selection` (the persisted development selection), `Preview` (the graph of the entry module with its addresses, and the entry document) and `Access` (grant verification, stream expiry and revocation). The preview compiles and classifies nothing: it asks the host facade for each artifact's public dependencies and runtime, and maps them to addresses. The one thing it reads by itself is the installed version of a package that the workspace does not contain. The module exports `guard(app, context)` and `setup(app, context)`, the two entry points the hosting service calls for an extension: `guard` is mounted before the service's own routes so that the session, state, selection, attachment, compiled-module and update routes require a grant too; `setup` mounts the routes of this contract. `context` is `{ delivery, settings }` with `settings.root` and, for the preview, `settings.runtime.base`, the installation the runtime resolves from.

Access is configured by the environment, never by a request: `BEYOND_AUTHORITY` (issuer and public keys, JSON) and `BEYOND_ENVIRONMENT` select delegated mode; without them the mode is local and nothing is required, which is the standalone command-line service. `BEYOND_TRUST_LOOPBACK=1` lets loopback requests through without a grant; a Workspace project container sets it because loopback there means processes that already hold the working copy, and routed requests never arrive on loopback. It must stay off wherever a proxy in the same network namespace forwards external requests.

Every read of disk that updates the index runs in one sequence with mutations, so a watcher hint never observes the middle of an API write. The operating system's recursive watcher only supplies hints; each hint is compared with disk, and a scan compares everything. Compilation keeps its own invalidation through the watchers service. Before each build the host is asked to refresh its declarations, because manifests are not watched by the compiler.

Validation, from the repository root with the bootstrap Engine serving this implementation:

```sh
BEE_URL=http://localhost:1112 node --import "$BEE_NODE_DIR/register.mjs" tests/development/index.mjs [files|service|preview]
```

The schema and its fixtures are checked without an Engine, with `node --test contracts/development/test/fixtures.test.mjs`. That test imports `ajv`, which this repository does not declare: it resolves today because an installed dependency brings it, so declare it before relying on the check in automation.

The `files` group runs the source and event scenarios against real disk writes and the real watcher. The `service` group runs the shared grant vectors, the HTTP preconditions, stream revocation and expiry, and build correlation; its build cases use a stand-in delivery so that timing can be driven, and say so in their name. The `preview` group runs the selection and preview scenarios over the same stand-in delivery: persistence, access, the addresses with and without a CDN origin, and the event filter. Real compilation behind this contract is validated through the Workspace project environment, which runs the hosting service in Docker, and [the preview validation](../tests/preview/README.md) runs the real service in delegated mode with a real browser: the routing of a module that is not selected, rendering behind a path prefix, and an update applied to the running page.

Limits of the current implementation:

- Build diagnostics carry the code and message Packages' delivery reports. `file`, `range` and `revision` are not filled, because delivery flattens positional diagnostics; the message contains the position as text.
- A build is `superseded` when any source file changed after its input cursor, not only one of its own inputs. That is conservative: it can discard a result that was still valid, never publish one that was not.
- `inspect.read` routes for packages, modules and dependencies, `process.control`, the repository capabilities and the legacy inspector adapter are not implemented.
- Grants travel only in the `Authorization` header, and a browser cannot add one to a module request. The preview is therefore designed for an authenticating proxy that adds it, which the preview validation exercises with a stand-in gateway; the proxy of a Workspace administration, its visitor links and their revocation are not part of Packages and were not validated here. Without such a proxy a browser reaches a preview only in local mode or over a trusted loopback.
- Nothing is hosted at a CDN origin today. A preview of any application needs at least the runtime of its artifacts from that origin, so until one exists `BEYOND_CDN_ORIGIN` must name a service that implements the compiled-module contract and answers cross-origin module requests (`Access-Control-Allow-Origin`). The dependencies of a module delivered by the CDN are read from its source in the workspace when it has one; the dependencies of a package the workspace does not contain are unknown to this service, because the contract defines the `beyond-resolution/1` document and no route that serves it.
- A preview applies updates only when the runtime of its artifacts has a coordinator, in the workspace or installed with the service. The development runtime is installed beside Packages under its provisional name (`@beyond-js/local-2026`) by the command line's acceptance installer and by the Workspace environment image; it is published in no registry and delivered by no hosted CDN, so its browser modules come from a stand-in origin in every validation. A project that uses the published Kernel is rebuilt on save and shown on reload. Styles and Widgets have no artifact, so nothing updates them.
- The selection has no revision: a replacement is last-write-wins, which fits one environment per user and project.
- Directory deletion and empty directories are not operations of the contract.

## Legacy inspector compatibility

The legacy inspector protocol is preserved for its existing consumers until an explicit migration. It is an adapter over the same operations, not a second file service.

| Legacy identifier | Disposition |
| --- | --- |
| `rpc-v2` / `response-v2-<id>` envelope | Preserve for legacy clients; new clients use this contract |
| `sources/save`, `sources/create`, `sources/rename`, `sources/delete` | Adapter onto mutations. The legacy payload has no revision, so the adapter reads the current revision and states it; a concurrent change surfaces as a legacy error instead of a silent overwrite |
| `sources/format` | Preserve as a stateless operation |
| `processors/sources/list` and `data` with the `{tu, data}` envelope | Adapter onto tree and read. The row shape `{id, version, code, hash, file, …}` is kept; `hash` maps to the revision |
| `bundle/change`, `application-styles`, `global-styles` | Preserve verbatim: shipped `@beyond-js/local` runtimes consume them |
| `project-process:<id>` | Preserve as a projection of build events |
| `dashboard/validate` | Not an authorization mechanism; delegated grants replace it in Workspace environments |

Legacy operations that never worked (`sources/clone`, `builder/module/delete`, rename through the missing `fs.rm`) carry no compatibility obligation beyond their names.
