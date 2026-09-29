# Bounded waits in the development service, 2026-09-29

Executed evidence for the findings of the family's bounded-waits audit that concern the development service (`service/`): SHR-09 to SHR-12. Every wait of a client of the service, of its supervisor launcher and of its host now ends within a configurable bound and turns into a named failure; the maintained description is in [the service guide](../../service.md#embedding-the-service). Committed locally on `feature/next`; nothing was pushed, published or hosted, and no dependency changed.

Paths are variables: `$SUITE_DIR` holds the component checkouts.

## Environment

| Component | Version |
| --- | --- |
| Packages | 0.0.1, `feature/next` over `a56f090` with these changes |
| Node.js | 22.21.1, macOS |
| Bootstrap | `bootstrap/` of this checkout, linked beside it as `node_modules/@beyond-js/packages-bootstrap` |

## Changes per finding

### SHR-09: selection and state had no bound (fixed)

`Connection.selection()` and `Connection.state()` fetched with no deadline, so a stuck service left `beyond run` and `beyond test` waiting with no output. They now run under `AbortSignal.timeout`, which covers the response body as well as the headers, bounded by the new `BEYOND_REQUEST_TIMEOUT` (`Connection.REQUEST`, 300 s; `Connection.limit(environment)`). An expired wait throws the existing `TimeoutError` with code `SERVICE_NOT_ANSWERING`, the path (`/selection` or `/state`, never the query, which carries local paths) and a message naming the variable. `BEYOND_SESSION_TIMEOUT` was not reused: its 5 s default bounds a description, while both routes build what changed, which takes minutes on a first build of a large workspace on a loaded host. The 300 s default is longer than the host's own bound on a reload (120 s), so a reload that does not settle is reported by the service as `UNAVAILABLE` first. The parsing of every such variable moved to one class, [`Deadline`](../../../service/deadline.mjs), which `Connection.deadline` and the host's `BEYOND_WATCHERS_TIMEOUT` use as well.

### SHR-10: a start that never became ready held the start lock forever (fixed)

- The launcher's wait for the supervisor's outcome is now [`Startup`](../../../service/startup.mjs), bounded by `BEYOND_START_TIMEOUT` (`Service.START`, 300 s: the bootstrap's preparation is bounded at 90 s, the watchers child at 15 s by default and 60 s in the Workspace environment image, the first read of the workspace at 120 s). When it expires, the launcher asks the supervisor it started to end (`SIGTERM`), which stops its host and its preparation; if the supervisor has not ended after 25 s (`Startup.GRACE`), its process group, which it leads because it is started detached, is killed. Only then does `acquire` reject, with `ServiceError` code `SERVICE_START_TIMEOUT` (new, additive) and the service log, so the start lock is released after the cleanup. The log path is now known before the supervisor names it, so an early exit is reported with it too. `ServiceError` moved to `service/errors.mjs` and is re-exported unchanged.
- The supervisor lets a preparation in progress settle (at most 10 s) before stopping it when it is asked to end, and does not start its host after an end began, so a start ended during the bootstrap's preparation does not leave the bootstrap Engine running in its own process group.
- The host reads the workspace within `BEYOND_WORKSPACE_TIMEOUT` (120 s): one that is not read in time fails the start with code `WORKSPACE_NOT_READY` and a message naming the variable, which the supervisor reports to the launcher as a failed start.
- A command waiting for another command's start lock (`Discovery.exclusive`) now waits as long as that start can last (start deadline, grace and two descriptions) instead of a fixed 120 s, and its message states the bound; before, a second command reported a start still in progress as a timeout.

### SHR-11: a reload that never settled hung every description (fixed)

The hosted workspace keeps its generations in [`Generations`](../../../service/host/generations.mjs). A reload after a manifest change is served only once it is ready; until then the previous workspace keeps answering the module routes. Requests to `/session`, `/state` and `/selection` that arrive during a reload share it. A reload that is not ready within `BEYOND_WORKSPACE_TIMEOUT` is discarded and answered `503` with `{ "error": { "code": "UNAVAILABLE", "message": … } }` (the service-level code of the compiled-module contract, mapped by `Routes.errors`); a reload that fails answers its own error. Either way the next request tries the reload again, so a reload that does not settle cannot leave the service stuck, and a manifest that changes during a reload is reloaded once that one ends. Before, a reload replaced the served workspace immediately, every description awaited its readiness without a bound, and a failed reload stayed in place with nothing retrying it. `Hosted.reloads` now counts replacements that became ready.

### SHR-12: attachments had no first-answer bound and no heartbeat (fixed)

- `Connection.attach()` waits for the service's first answer within `BEYOND_SESSION_TIMEOUT` (the service writes it as soon as the stream opens) and throws `TimeoutError` (`SERVICE_NOT_ANSWERING`, path `/attach`).
- The host's attachment stream writes a comment line `: heartbeat` every 20 s (`Attachments.HEARTBEAT`, as the development extension's `/events`) and announces the interval as `heartbeat` in its `attached` event. A write to a client whose connection is gone closes that attachment.
- A client of a service that announced a heartbeat treats 2.5 heartbeats of silence (`Connection.SILENCE`, 50 s) as a service that stopped answering: it closes the stream and calls `stopping('the service stopped answering')`, as when the service ends. A service that announces none is not held to one.

The protocol keeps its meaning for existing consumers: comment lines are ignored by event-stream parsers; the only parser of the stream, `Connection.attach` (used by the command line's `run`, `test` and session and by the Workspace environment's entry point and warm-up, read in their checkouts), matches `event: stopping` and `event: attached` and ignores the heartbeat; `attached` gained a field.

## Tests and results

New cases, with the checked-in stand-ins of [`service/test/support`](../../../service/test/support/README.md) (a server that accepts and never answers, one that sends headers and stalls the body, one that answers `503`, an attachment that goes silent; stand-in supervisors that never report or ignore `SIGTERM`; workspace generations that never become ready or fail). Each injects a short bound and asserts the outcome by its code or name.

| File | Cases | What they establish |
| --- | --- | --- |
| `connection.test.mjs` | 7 new, 10 in all | `BEYOND_REQUEST_TIMEOUT` parsing; `/state` never answered and `/selection` with a stalled body end as `SERVICE_NOT_ANSWERING` naming the path and the variable; a `503` is `UNAVAILABLE`, not a timeout; an unanswered attachment ends within the first-answer bound; a silent attached service is reported as `the service stopped answering`, and one that keeps its heartbeat past that silence is not |
| `attachments.test.mjs` | 2 | The stream announces its heartbeat and sends it; a real `Connection.attach` stays attached across five heartbeats and receives the `stopping` reason |
| `startup.test.mjs` | 3 | A supervisor that never reports is stopped and the start fails `SERVICE_START_TIMEOUT` with its log; one that ignores `SIGTERM` is killed with its process group (its child is gone); a ready one gives its record |
| `generations.test.mjs` | 5 | A workspace never read fails the start `WORKSPACE_NOT_READY` and is destroyed; a stalled reload is `UNAVAILABLE` (503) with the previous workspace still served; the next request retries and serves the new one; concurrent requests share one reload; a failed reload reports its own error and is retried |

```sh
cd "$SUITE_DIR/packages"
node --test "service/test/*.test.mjs"    # 28 tests, 28 pass, 0 fail (11 before these changes)
(cd bootstrap && npm test)               # 3 tests, 3 pass (unchanged code, run as a regression)
```

A real service was also started from this checkout with the bootstrap, against a temporary copy of the command line's `standalone` acceptance fixture and a temporary `BEYOND_HOME`, by a throwaway script outside the repository: it started (4–15 s), answered a selection and a state, reloaded the workspace through `Generations` after a manifest gained an export (the new module was selected and described), and ended when detached, leaving no process whose arguments or working directory named the temporary directory. With `BEYOND_START_TIMEOUT` at 3000 and 9000 ms the start failed `SERVICE_START_TIMEOUT` with the service log about 0.6 s after the deadline, with the bootstrap Engine already running, and left no such process either. The log lines `Listener for file "[object Object]" is already destroyed` written after a reload appear identically with the code before these changes. `BEYOND_WORKSPACE_TIMEOUT=1` did not make the real start fail, because the fixture's workspace is ready before the timer fires, so the host's workspace bound is established by the unit cases only.

## Not done

- The `503` of a reload through the real host's routes was not executed: nothing can make a real Packages workspace stall on demand. `Generations` is exercised directly, and `Routes.errors` maps a `ContractError` `UNAVAILABLE` to 503 by its existing contract.
- The command line's acceptance was not run; it installs a toolchain and is not cheap. The command line reports a `TimeoutError` from `selection()` or `state()` with its stack, as it already reports one from a reused service's validation, because its error handler names `ServiceError`, `ContractError` and `AccessError` only. Adding `TimeoutError` there belongs to the `cli` repository.
- Building a module has no bound of its own in the service; `BEYOND_REQUEST_TIMEOUT` bounds the client's wait, not the build. Builds are long work whose liveness the compiler's own failure reporting (`COMPILER_UNAVAILABLE`) covers.
- Extension loading and listening are bounded only by the overall start deadline.

## Family reference synchronization

Packages has no end-user screen. The developer-visible states that changed, for the suite owner to apply to the family reference's representation of the command line, the Workspace environment and the Dev Server:

| Where | Before | Now |
| --- | --- | --- |
| `beyond run` / `beyond test`, first start | Could wait forever with no output when the service never became ready | Fails after `BEYOND_START_TIMEOUT` (5 min) with "the development server could not be started: … did not become ready within …ms and was stopped. Raise BEYOND_START_TIMEOUT if the host is slow" and the path of the service log; the started processes are gone |
| A second command while the first start is in progress | Failed after 120 s with "Timed out waiting for another command to start the service", although the start was healthy | Waits as long as that start can last, then names the bound |
| `beyond run` / `beyond test` against a service that stopped answering | Waited forever | Fails after `BEYOND_REQUEST_TIMEOUT` (5 min) with `SERVICE_NOT_ANSWERING` naming `GET /selection` or `GET /state` and the variable |
| Description routes during a reload (`/session`, `/state`, `/selection`; Workspace's administration reads `/session` for its readiness probe and `/state` for its integration review, and its environment's warm-up reads `/state`) | Waited as long as the reload, forever if it never settled; a failed reload stuck | `503` `UNAVAILABLE` "…being reloaded… Repeat the request" after `BEYOND_WORKSPACE_TIMEOUT` (2 min), the previous workspace served meanwhile; the next request retries |
| An attached session, application or Workspace environment | A half-open attachment went unnoticed | Ends with "the development server stopped: the service stopped answering" after 50 s of silence |

Outcome: **synchronization blocked on the suite owner** — this assignment may not edit the suite's `branding/`. Affected: the command line's start and failure states, and Workspace's environment readiness and integration review while a reload is not ready (they now receive `503` `UNAVAILABLE` rather than a request that does not end). Remaining work: represent the named start timeout and the reload `UNAVAILABLE` state with its retry.
