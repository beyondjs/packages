# Development contract: files, events and builds

`beyond-dev-files/1` is the versioned contract of the Dev Server's source operations, change events and build correlation. Packages owns it, as described in [Dev Server and File API](development-server.md). This guide explains the rules; the machine-readable parts live in `contracts/development`:

| File | Content |
| --- | --- |
| `schema.json` | JSON Schema 2020-12 definitions: `path`, `revision`, `cursor`, `tree`, `mutation`, `result`, `batch`, `event`, `build`, `diagnostic` |
| `fixtures/valid`, `fixtures/invalid` | Documents named `<definition>.<case>.json` that must pass or fail their definition |
| `scenarios.json` | Behavior every implementation must reproduce: conflicts, external writes, replay, gaps, stale builds, access |

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

Saving a file, completing a build, delivering an artifact and applying an update in a runtime are four different facts. This contract reports the first two. Artifact delivery is the compiled-module contract; applying an update is reported by the runtime.

## Access

In a Workspace project environment every route, including artifact and event routes, requires a `beyond-dev-grant/1` bearer grant signed by the central administration. The Dev Server holds the authority's public keys, its own environment identifier and the latest signed revocation list. It holds no users, teams or roles.

| Capability | Allows |
| --- | --- |
| `session.read` | Session description |
| `files.read` | Tree and content |
| `files.write` | Mutations and batches |
| `events.subscribe` | The event stream |
| `inspect.read` | Package, module and dependency inspection |
| `build.control` | Requesting and cancelling builds |
| `process.control` | Starting and stopping development processes |
| `artifacts.read` | Compiled modules, for a preview or a runtime |
| `repository.read`, `repository.write` | Git state, and commit or push |

A refusal is `401` with `GRANT_MALFORMED`, `GRANT_KEY`, `GRANT_SIGNATURE`, `GRANT_ISSUER`, `GRANT_AUDIENCE`, `GRANT_EXPIRED` or `GRANT_REVOKED`, or `403` with `GRANT_CAPABILITY`. Expiry and revocation also end open event streams with `access.ended`. The standalone command-line service keeps its loopback binding and owner token; delegated access is the mode of a Workspace environment, not a new requirement of the standalone tool.

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
| Revocations | `PUT /access/revocations` with the signed list as body | `204` | `401`, `409 REVOCATIONS_STALE` |

`PATH_FORBIDDEN` covers a path that resolves outside the root through a symbolic link and the repository's internal `.git` directory. The revocation route needs no bearer: the list is self-authenticating and ordered.

## Implementation and limits

`Development` composes the collaborators: `Files` (root rules, revision index, mutations, disk observer), `Log` (epochs, cursors, replay), `Builds` (input correlation over the host's delivery facade) and `Access` (grant verification, stream expiry and revocation). The module exports `guard(app, context)` and `setup(app, context)`, the two entry points the hosting service calls for an extension: `guard` is mounted before the service's own routes so that the session, state, selection, attachment and compiled-module routes require a grant too; `setup` mounts the routes of this contract. `context` is `{ delivery, settings }` with `settings.root`.

Access is configured by the environment, never by a request: `BEYOND_AUTHORITY` (issuer and public keys, JSON) and `BEYOND_ENVIRONMENT` select delegated mode; without them the mode is local and nothing is required, which is the standalone command-line service. `BEYOND_TRUST_LOOPBACK=1` lets loopback requests through without a grant; a Workspace project container sets it because loopback there means processes that already hold the working copy, and routed requests never arrive on loopback. It must stay off wherever a proxy in the same network namespace forwards external requests.

Every read of disk that updates the index runs in one sequence with mutations, so a watcher hint never observes the middle of an API write. The operating system's recursive watcher only supplies hints; each hint is compared with disk, and a scan compares everything. Compilation keeps its own invalidation through the watchers service. Before each build the host is asked to refresh its declarations, because manifests are not watched by the compiler.

Validation, from the repository root with the bootstrap Engine serving this implementation:

```sh
BEE_URL=http://localhost:1112 node --import "$BEE_NODE_DIR/register.mjs" tests/development/index.mjs [files|service]
```

The schema and its fixtures are checked without an Engine, with `node --test contracts/development/test/fixtures.test.mjs`. That test imports `ajv`, which this repository does not declare: it resolves today because an installed dependency brings it, so declare it before relying on the check in automation.

The `files` group runs the source and event scenarios against real disk writes and the real watcher. The `service` group runs the shared grant vectors, the HTTP preconditions, stream revocation and expiry, and build correlation; its build cases use a stand-in delivery so that timing can be driven, and say so in their name. Real compilation behind this contract is validated through the Workspace project environment, which runs the hosting service in Docker.

Limits of the current implementation:

- Build diagnostics carry the code and message Packages' delivery reports. `file`, `range` and `revision` are not filled, because delivery flattens positional diagnostics; the message contains the position as text.
- A build is `superseded` when any source file changed after its input cursor, not only one of its own inputs. That is conservative: it can discard a result that was still valid, never publish one that was not.
- `inspect.read` routes for packages, modules and dependencies, `process.control`, the repository capabilities and the legacy inspector adapter are not implemented.
- Grants travel only in the `Authorization` header. A browser preview that loads compiled modules needs a transport for `artifacts.read` that never exposes a platform credential; it is not defined yet.
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
