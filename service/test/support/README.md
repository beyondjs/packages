# Service test support

Stand-ins that let the `service/test` cases exercise a wait that never ends, with a short bound injected by the case, and assert the outcome by its code. They are harness infrastructure, not applications, so they live here rather than under `fixtures/`. Nothing here is compiled or discovered by Packages.

| File | Stands in for | Used by |
| --- | --- | --- |
| [stalling.mjs](stalling.mjs) | A development service on an ephemeral loopback port that is there and does not answer: `silent` (accepts and never answers), `headers` (sends `200` and stalls the body), `unavailable` (answers `503` `UNAVAILABLE`), `attached` (opens an attachment, announces a heartbeat, sends a given number of heartbeats and goes silent) | `connection.test.mjs` |
| [supervisor.mjs](supervisor.mjs) | The supervisor a client starts detached with an IPC channel: `silent` (never reports, ends on `SIGTERM`), `stubborn` (never reports, ignores `SIGTERM`, starts a child in its process group and writes its pid to a file), `ready` (reports a ready record at once) | `startup.test.mjs` |
| [workspaces.mjs](workspaces.mjs) | Generations of a hosted workspace, with a readiness the case decides: `ready`, `stalled` (never settles), `failing` (rejects with `READ_FAILED`) | `generations.test.mjs` |

Run them with the rest of the suite from the repository root:

```sh
node --test "service/test/*.test.mjs"
```

Expected: every case passes within about a second of bounds; a case that hangs is a regression of the bound it tests. The cases stop only what they started, by pid or by the process group of the stand-in supervisor they spawned.
