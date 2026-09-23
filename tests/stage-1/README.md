# Stage 1 validation: two packages compiled by Packages

Validates that Packages discovers two workspace packages, selects their bundler and conditions, processes their sources, writes separate executable artifacts that preserve the public bare reference, regenerates the right artifact after real source edits (through the watchers service) and produces updates that a live consumer applies to the original runtime package.

Each behavior is also checked in the negative, which is what a package developer sees when something is wrong: contradictory declarations, an unregistered or unimportable bundler, an undeclared or incompatible dependency, a module that does not build for the requested conditions, and a source that does not compile.

The fixture is the suite-owned `testbed/module-updates/` (`@suite/shared` with `./message`, `@suite/app` with `./main` importing `@suite/shared/message`). The run copies it, without its `.artifacts/`, into a unique temporary directory, compiles and edits that copy, writes the artifacts to its `.artifacts/` and removes it at the end; the permanent scenario is only read. Read its README for how those packages are authored, and the stage record in the suite documentation for the selected contracts and the observed results.

The default scenario is located beside the Packages checkout under the suite testbed. Set `BEYOND_TESTBED` to a different testbed index directory when needed; the driver selects its `module-updates` child. The permanent scenario is also available for manual inspection.

## Prerequisites

- Node 22.21.1 or later, Engine 1.4.1 and BEE Node, configured as in the BEE Node run guide (`ENGINE_DIR`, `PACKAGES_DIR`, `BEE_NODE_DIR`); dependencies installed in Engine and Packages.
- The watchers utility checkout (`utils/watchers` in the suite) with its dependencies installed (`npm install --no-audit --no-fund`), because the published `@beyond-js/watchers` has no compiled service. Its `node-esm` distribution serves the service on port 1120.

## Run

Terminal 1, the Packages implementation (ports 1110–1112):

```sh
cd "$PACKAGES_DIR"
node "$ENGINE_DIR/index.js"
```

Terminal 2, the watchers utility (port 1120):

```sh
cd "$SUITE_DIR/utils/watchers"
node "$ENGINE_DIR/index.js"
```

Terminal 3, the validation, from the Packages directory (the consumer resolves the runtime kernel from here):

```sh
cd "$PACKAGES_DIR"
BEE_URL=http://localhost:1112 WATCHERS_URL=http://localhost:1120 \
  node --import "$BEE_NODE_DIR/register.mjs" tests/stage-1/index.mjs
```

Expected: every step prints `PASS …` and the run ends with `21/21 steps passed` (exit code 0). Failures print the assertion and the run continues, so one report shows all outcomes; the permanent scenario is unchanged in every case, and `git status` of the suite shows nothing under `testbed/`.

Negative cases build further temporary copies of the fixture. The steps that validate rebuilding edit the run's copy and restore it themselves, because restoring two files is itself a checked update. Changing the permanent scenario changes what this run asserts: values, exports, internal-module identities and artifact hashes are checked explicitly.

## What each file is

- `index.mjs`: owns the services the checks need — the watchers service, the workspace, the artifacts writer and the consumer — runs the two groups of checks and cleans up.
- `copy.mjs`: the run's temporary copy of the scenario, where its artifacts are written, and its removal. Only this validation imports it.
- `harness.mjs`: the location of the permanent scenario, how a step is run and reported, how a variant of the fixture is built, and the `Consumer` that drives the process executing the artifacts. Other validations import it for its step infrastructure; importing it has no side effect.
- `build.mjs`: what Packages produces — discovery, bundler and conditions, artifacts, dependencies between packages — with the corresponding failure cases.
- `updates.mjs`: what a running consumer observes — execution of the artifacts, watched regeneration, application of updates, compilation errors and recovery.
- `consumer.mjs`: the process that executes the artifacts, described below.

## What each process is

- This process (BEE Node with `BEE_URL`): runs Packages, so the implementation under test is the one the development server compiles.
- The watchers child (spawned by `WatchersService` with the same loader and `BEE_URL=WATCHERS_URL`): the real filesystem watcher service.
- The consumer (spawned with BEE Node and `BEE_IMPORT_MAP` set to the `.artifacts/importmap.json` of the run's copy, no Engine, no HTTP): imports `@suite/app/main` and `@suite/shared/message` from the artifacts, then applies the updates Packages regenerates, reporting values, runtime identities and evaluation counters over IPC. It stays alive for the whole run, which is what makes an update observable: it is applied to modules that are already loaded.

With the utilities served from their sources, a run prints no `Error emitting event … reading 'emit'` line. Two per edit come from the **installed** Finder utility, whose published version reads the emitter of the dynamic processor as `undefined`; [the utilities validation](../utilities/README.md) is where that is checked, and `BEE_URL` is where it is selected.
