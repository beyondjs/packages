# Development tests: the development contract and the compiled-module routes of the service

Validations of what the development service answers besides compiling: the development contract of `@beyond-js/packages/development` (files, events, builds, grants, selection, preview) and the compiled-module contract as the HTTP routes of `@beyond-js/packages/http/routes` implement it.

## Run

From the Packages directory, with an Engine serving this implementation (see [the stage-1 prerequisites](../stage-1/README.md)):

```sh
BEE_URL=http://localhost:1112 node --import "$BEE_NODE_DIR/register.mjs" tests/development/index.mjs [files|service|preview]
BEE_URL=http://localhost:1112 node --import "$BEE_NODE_DIR/register.mjs" --test tests/development/contract.test.mjs tests/development/preview.test.mjs
BEE_URL=http://localhost:1112,http://localhost:1120 WATCHERS_URL=http://localhost:1120 BEYOND_ROUNDS=30 \
  node --import "$BEE_NODE_DIR/register.mjs" --test tests/development/writes.test.mjs
```

`index.mjs` runs numbered steps and prints `N/N steps passed`; the `*.test.mjs` files run under Node's test runner, one process per file. Only `writes.test.mjs` needs the watchers service, which it starts from `WATCHERS_URL`; nothing else is watched. `BEYOND_ROUNDS` (5 by default) is how many times it breaks and corrects each source. The utilities validation of the suite (`utils/validation/served.mjs`) can serve this implementation and the utilities from their sources on free ports instead of fixed Engines.

## What each part establishes

| File | Established |
| --- | --- |
| `files.mjs`, `service.mjs`, `preview.mjs` (`index.mjs`) | The scenarios of `contracts/development/scenarios.json` over temporary roots, with a stand-in delivery where the timing of builds must be driven: source operations and events, grants and preconditions, build correlation, declarations, selection and the preview document. See [the development contract](../../docs/development-contract.md#implementation-and-limits) |
| `contract.test.mjs` | The conformance rules of `@beyond-js/artifact-api` 0.3.0 against the real routes and delivery, in `esm` and `system`, the inline-map rule included, with the resolution documents and cross-origin reading; `/resolution.json` and `/importmap.json` with installed packages under their source and a scope for an importer of another version; `format=system` for modules and for the `/u/` updates of a composed module; the source of an installed package in its path (npm unprefixed, another registry by its id, Git refused); stylesheets as `<specifier>.css`; the stylesheet of a style module of the esbuild packaging mode served, and its JavaScript `OUTPUT_NOT_AVAILABLE` (with a bounded wait, so a request that never settles fails); the service-level `NOT_FOUND` |
| `writes.test.mjs` | Two writes of one source in quick succession, with the real watchers service and the state `GET /state` answers ([Watched](support/watched.mjs)): a Vue component and a stylesheet of its module are broken, the state is asked for without pause until it reports the failure, and the correction is written at once, inside the 50 ms in which chokidar reports one change of a path; the correction must be reported valid within 15 s, every round. Without the recheck of the watchers service (its published 1.0.7, or its sources before 2026-09-23) a correction dropped there was never built: in a fresh workspace per round, 26 of 30 Vue and 16 of 30 stylesheet corrections were lost, and this file failed in its first rounds; with the service that examines an announced file again after the window, 0 of 30 and 0 of 30, and this file passes at 30 rounds |
| `preview.test.mjs` | The addresses of the preview over the real delivery: installed packages under their source, the scope of an importer of another version, and a workspace package that is not in development on the CDN under the registry its `publishConfig` names |

## Fixtures

| Location | What it is |
| --- | --- |
| [`fixtures/contract`](fixtures/contract/README.md) | A workspace of three packages with installations from npm, from another registry and from Git, and its lockfile |
| [`fixtures/writes`](fixtures/writes/README.md) | One package with a Vue component and a stylesheet in one module, which `writes.test.mjs` breaks and corrects |
| `harness.mjs`, `service.mjs` | The temporary roots and the stand-in delivery of `index.mjs`, whose small sources are written inline by each step (they predate the fixture rule and keep their scenario identities) |

[`support/watched.mjs`](support/watched.mjs) serves a copy of a fixture as the host of the service does, watched, and asks for its state. [`support/served.mjs`](support/served.mjs) serves a copy of `fixtures/contract` with the real delivery on an allocated port, and gives a host's facade over it (the delivery with the source of each package) to the development extension.

## Not covered

A browser, a hosted CDN and installations from a package manager that writes no npm lockfile are not exercised. Stylesheets selected by specifier (`pkg/sub.css`) are resolved from what the build reports, which the fixture's bundlers do not report yet.
