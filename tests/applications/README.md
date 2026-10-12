# Applications validation

Runs the catalog of applications and execution targets ([applications](../../docs/applications.md), `beyond-applications/1`) on the real development service, started from this checkout through `@beyond-js/packages/service` as the command line starts it: its supervisor prepares Packages with the bootstrap Engine and starts the host with the development extension and pairing. Nothing is a stand-in: the catalog, the File API, the watchers service, the preview and the host's reloads are the ones of the checkout.

## Run

From the Packages directory, one file at a time (each starts its own service; the first start of a machine compiles Packages with Engine, which takes minutes):

```sh
node --test tests/applications/catalog.test.mjs
node --test tests/applications/events.test.mjs
node --test tests/applications/npm.test.mjs
node --test tests/applications/standalone.test.mjs
```

Prerequisites: Node 22.21.1 or later and the checkout's dependencies, its bootstrap included, as for [the portable validation](../portable/README.md); the development runtime's sources (`BEYOND_RUNTIME`, or the suite's `local-2026` beside this repository), which the harness copies into each workspace as its member `runtime`; and `mkfifo` for the case of a FIFO outside the workspace, which is reported and skipped without it.

## What each file establishes

| File | Established |
| --- | --- |
| `catalog.test.mjs` | The session claims `applications`; the catalog lists the declared applications and targets in their order, and a library module no application declares is no target; a frontend target resolves to its entry, its browser output, the composition of its page by source and its preview document, which the preview listener serves; a backend target resolves to its Node output and can be launched by its public specifier (`launch.specifier`), a Deno one requires Deno, an unsupported runtime is a warning and not launchable, and a missing package, a missing entry and an entry without a browser output say so; a write creates (`If-None-Match: *`), replaces and removes (`If-Match`) one application, conflicts on a stale revision, and keeps every other character of the document (unrelated fields, key order, tabs, final newline, a one-line target); writes need a precondition (`428`), a JSON body (`415`, `400`) and a valid application (`422` with the diagnostic codes); a paired page reads and writes, a local consumer and a page of another site do neither, a revoked pairing is refused; a branch in its own file is read from it and written to it, `beyond.json` unchanged, and the revision of `beyond.json` does not stand for the file's; a list, a file outside the workspace (by its path, through a link, in `.git`, absolute, a FIFO) and a malformed `beyond.json` are refused without being read or rewritten, and a missing file is reported and written by the first creation; a branch that names a manifest (a member's `package.json`, a `module.json`, `beyond.json` itself or another one), the lock or a file under `.beyond` is `APPLICATIONS_FILE_INVALID`, and no `PUT` or `DELETE` of an application (`name`) reaches it, the manifest unchanged |
| `events.test.mjs` | With `BEYOND_APPLICATIONS_FOLLOW=watchers`, so that only `Config` and the watchers service follow the declaration: an external edit of `beyond.json` is announced as `applications.changed` after the File API's own event, without a request; a write through the catalog is announced after its `api` file event with the revision it answered; a branch in its own file is followed too, and six rapid edits converge on the last with growing generations; a malformed file gives diagnostics and its correction converges; **measured**, the build after an edit of the applications in their own file, inline in `beyond.json` (which the host compares without its applications) or of a file that declares nothing reloads nothing, every output hash unchanged (the durations are printed as test diagnostics); a changed `package.json` of a member announces `workspace.changed` after its file event |
| `npm.test.mjs` | A `beyond.json` that holds only applications beside npm `workspaces` is no conflict: the members are served and the applications listed and resolved; adding `packages` to it is `WORKSPACE_CONFIG_CONFLICT` with no member while the applications are still listed, and removing them recovers, each reload announced as `workspace.changed` |
| `standalone.test.mjs` | A standalone package without dependencies, installed by the service (`POST /installation`, its source store and metadata cache directories of the case, nothing requested): creating its `beyond.json` with its first application leaves it `standalone`, its installed graph `ready` with no diagnostic and its lock untouched, while the catalog lists the application |

## Fixtures

[`fixtures/`](fixtures/README.md): the workspaces the services serve. The harness ([support/served.mjs](support/served.mjs)) copies one into a unique temporary directory with its own `BEYOND_HOME`, copies the development runtime in, holds the service as its owner with the local credential and stops it by detaching, waiting for its record to be removed. The cases write the files they edit in the copy, inline: short declarations and edits whose content is the input under test.

## Not covered

The Packages interface, the command line's `beyond targets`, launching a target ([launches](../../docs/launches.md)) and a workspace installed with `beyond install` are validated elsewhere or not here. The measured durations are of one machine and one small workspace; they show which edits compile again, not a performance bound.
