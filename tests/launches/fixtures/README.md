# Launch fixtures

Used by the validations of [tests/launches](../README.md) and by the launch unit tests of `service/test`, which copy or run them and never write them.

## workspace/

A `beyond.json` workspace served by the real development service with the development extension. The harness adds `runtime/`, the manifest and exported module directories of the development runtime (`@beyond-js/local-2026`), which both packages are assembled against (`runtime` of the `ts` bundler).

- `beyond.json` declares the packages `runtime`, `api` and `web`, and the application `fixture` with three execution targets: `api`, a backend in Node (`@launches/api`, entry `./server`, readiness `fixture API listening`); `worker`, the same entry declared for Deno; and `web`, a frontend (`@launches/web`, entry `./main`).
- `api/` is `@launches/api` 1.0.0. `./server` (`platforms: ["node"]`, `server/index.ts`) starts an HTTP server on `127.0.0.1` at the port `LAUNCH_FIXTURE_PORT` names or one the system gives, prints `fixture API listening on <address> (<node or deno>)` once it listens, answers `GET /health` with `{status: 'ready', runtime, pid, started, loader}`, and on `SIGTERM` prints `fixture API stopping` and exits with 0. The same module runs in Node.js and in Deno.
- `web/` is `@launches/web` 1.0.0. `./main` (`platforms: ["web"]`, `main/index.ts`) marks the body of the page that opens it; it is a frontend entry, refused by a launch.

Expected behavior: the service builds every module; a launch of `fixture/api` is ready and answers; `fixture/worker` behaves the same in Deno; a launch of `fixture/web` is refused with `TARGET_FRONTEND`.

## stand-ins/

What the unit tests of the feature run instead of the toolchain. Nothing here is compiled by Packages.

- `register.mjs` stands for the BEE Node registration given to `node --import`: it registers no loader and leaves the loader configuration it saw for the launcher to report.
- `launcher.mjs` stands for the command line's launcher: given `stand-in/<behavior>` as its specifier, it behaves so instead of importing it. `server` reports what its process received (the registration, its directory and arguments, the loader variables, the variables that must not reach it, among them the reserved `NODE_OPTIONS` and `DENO_DIR`, the target's variables) and serves HTTP, printing `stand-in listening on <address>`, until `SIGTERM`; `stubborn` says it listens and ignores `SIGTERM`; `silent` lives without saying it is ready; `partial` writes its readiness without a final newline; `crash` writes to both streams and exits with 3; `finish` writes one line and exits with 0; `flood` writes 1500 lines, a 5000-character line, a colored line and a rewritten progress line, then says it listens; `chatty` writes a line every 10 ms for a second; `orphan` starts a process that keeps its output open and exits with 0, printing that process's identifier so the case can end it.
- `deno.mjs` stands for a Deno 2 executable (`#!/usr/bin/env node`): the case copies it to a directory of its own and makes the copy executable. Asked for `--version`, it answers `deno 2.1.4 (stable, release, stand-in)`, which the feature checks at every launch. Otherwise it prints `deno <JSON>` with the arguments it was given, whether its entry module exists, `DENO_DIR` and whether that directory exists, `NO_COLOR` and `BEE_URL`, then `stand-in listening in deno`, and ends on `SIGTERM`.
