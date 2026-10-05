# Service test support

Stand-ins that let the `service/test` cases exercise a wait that never ends, with a short bound injected by the case, and assert the outcome by its code, and stand-ins for the Packages classes a host composes, so its routes are tested without the loader. They are harness infrastructure, not applications, so they live here rather than under `fixtures/`. Nothing here is compiled or discovered by Packages.

| File | Stands in for | Used by |
| --- | --- | --- |
| [stalling.mjs](stalling.mjs) | A development service on an ephemeral loopback port that is there and does not answer: `silent` (accepts and never answers), `headers` (sends `200` and stalls the body), `unavailable` (answers `503` `UNAVAILABLE`), `attached` (opens an attachment, announces a heartbeat, sends a given number of heartbeats and goes silent) | `connection.test.mjs` |
| [departing.mjs](departing.mjs) | The supervisor `Service` starts, given as `Service.SUPERVISOR`: reports at once a ready record naming an address where nothing answers, and ends when its launcher disconnects (or after ten seconds), so a case proves that a start happened without starting a service | `acquire.test.mjs` |
| [supervisor.mjs](supervisor.mjs) | The supervisor a client starts detached with an IPC channel: `silent` (never reports, ends on `SIGTERM`), `stubborn` (never reports, ignores `SIGTERM`, starts a child in its process group and writes its pid to a file), `ready` (reports a ready record at once) | `startup.test.mjs` |
| [workspaces.mjs](workspaces.mjs) | Generations of a hosted workspace, with a readiness the case decides: `ready`, `stalled` (never settles), `failing` (rejects with `READ_FAILED`) | `generations.test.mjs` |
| [answering.mjs](answering.mjs) | A development service that answers: each route (`GET /session`, `POST /installation`, …) answers the status and JSON body the case gives it (or ends the connection once the request was read, or answers a body that is not JSON, as a gateway does), and every request is recorded with its method, path, content type and body | `install.test.mjs`, `acquire.test.mjs` |
| [routes.mjs](routes.mjs) | The installation routes of a host (`InstallationRoutes` over an `Installer` and a `Stand`, with the queue bound, the installation deadline and the `Holds` a case gives), mounted on an ephemeral loopback port as the host mounts them: before a middleware that lets any origin read every answer, with a service's error handler; `send()` sends exactly the headers a case gives, `Host` included | `installer.test.mjs`, `admission.test.mjs`, `turns.test.mjs` |
| [host.mjs](host.mjs) | Not a stand-in: the real host of the service (`service/host/main.mjs`) started from this checkout as its supervisor starts it, in its own process group, attached as its owner, and stopped by that group. Needs BEE Node and `BEE_URL`/`WATCHERS_URL` | `tests/local-install/service.test.mjs` |
| [installation.mjs](installation.mjs) | What the installation routes of a host use, as a `Stand`: the declaration (`Declaration.read`), the projection (`Execution.read`), the class that installs, given through a loader (held, failing or answering a report), and the hosted workspace reloaded after an installation (settling or not); it records the reads, the installations and the reloads | `installer.test.mjs` |

Run them with the rest of the suite from the repository root:

```sh
node --test "service/test/*.test.mjs"
```

Expected: every case passes within about a second of bounds; a case that hangs is a regression of the bound it tests. The cases stop only what they started, by pid or by the process group of the stand-in supervisor they spawned.
