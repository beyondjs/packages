# Type browsing and local settings validation

Runs [type browsing](../../docs/development-contract.md#type-browsing) (`beyond-types/1`, `GET /types`) and the [local Dev Server settings](../../docs/settings.md) (`beyond-dev-settings/1`, `GET`/`PUT /settings`) against the real development service, started from this checkout through `@beyond-js/packages/service` as the command line starts it: its supervisor prepares Packages with the bootstrap Engine and starts the host with the development extension and pairing. Nothing is a stand-in: the host, its settings feature, the development extension compiled by Engine and its `ts` and esbuild bundlers are the ones of the checkout. The test process holds each service as its owner and is a local tool (it presents the local credential).

## Run

From the Packages directory, one file at a time (each starts its own service):

```sh
node --test tests/types/types.test.mjs
node --test tests/types/settings.test.mjs
```

Prerequisites: Node 22.21.1 or later and the checkout's dependencies, its bootstrap included (`node_modules/@beyond-js/packages-bootstrap` linked to `bootstrap/`), as for [the portable validation](../portable/README.md); the development runtime's sources, from `BEYOND_RUNTIME` or the suite's `local-2026` checkout beside this repository, which the harness copies into the workspace; `/bin/sh` for the stand-in Deno executables. No network: nothing is fetched, and the CDN of the settings cases is a loopback stand-in. `BEE_HTTP_TIMEOUT` is raised to 180 s for the loader of the host unless it is set.

## What each file establishes

| File | Established |
| --- | --- |
| `types.test.mjs` | The session claims `types` and `declarations`. A workspace module answers its generated declaration (`generated`, with `vspecifier`, the declaration's hash, the source log cursor) — the same text `GET /declarations` serves — and the references its public types keep, with the importer to follow them. Installed packages answer, from the importer, what a type check reads: a `types` field, an `exports` `types` condition reached after an `import` target with no declaration beside it, a `default` target after an `import` one, a `./*` pattern, `typings`, `types` without an extension, a subpath file and a subpath directory, TypeScript sources (`form: source`), and an `@types` package (`types-package`) with its reference directive; a reference followed from an installed package reaches the release installed for that package, not the workspace's. Refused by code: an excluded and an unexported subpath, a package without declarations and one not installed (`DECLARATION_NOT_FOUND`); a `types` field outside the package and a declaration that is a symbolic link out of it (`TYPES_ACCESS`); a declaration past 1 MiB, a Git installation, a style module, Node builtins and Git or archive addresses (`TYPES_UNSUPPORTED`); a module that does not check, with its located diagnostic (`DECLARATION_INVALID`); the fixture's esbuild module and the development runtime's `@beyond-js/local-2026/bundle` (`DECLARATION_PRODUCER_MISSING`, naming the esbuild bundler), while `GET /declarations` keeps its own answer; malformed specifiers and importers (`TYPES_REQUEST_INVALID`). A local consumer, a page of another site and the preview listener are refused |
| `settings.test.mjs` | The session claims `settings`. A value the environment sets is fixed (`source: environment`) and its change is refused (`SETTING_FIXED`); an empty variable is no value. A change of `cdn.origin` reaches the next `GET /preview/entry.json` without a restart, and back to none; a change of `previews.timeout` bounds the CDN checks of the next description (a loopback CDN that never answers is `PREVIEW_CDN_UNAVAILABLE` within 500 ms, not 5 s); the change is announced as `settings.changed` on `GET /events` with its revision; the file is `0600`. A Deno stand-in that answers as Deno 1 is refused and one that answers as Deno 2 is kept, on a service started with the `launch` setting (the stand-in registration and launcher, never run); a change based on an older revision is a conflict that changes nothing. A settings file readable by other users is not read (`SETTINGS_FILE_UNTRUSTED`) and the next change replaces it with one of mode `0600`. A local consumer and a page of another site reach no settings route |

The feature's own cases — conflicts, every validation, changes by hand, delegated access, the bound of the Deno check and the end of what a hung executable starts, and the bound a starting host reads — are unit tests of `service/test` (`settings*.test.mjs`).

## Fixtures

[`fixtures/`](fixtures/README.md): the workspace, the packages that become its `node_modules`, and what the harness ([support/served.mjs](support/served.mjs)) adds to the copy. The harness copies them into a unique temporary directory with its own `BEYOND_HOME`, starts the service, stops it by detaching its owner and waits for its record to be removed; it never writes the checked-in files. The settings cases write their stand-in Deno executables into temporary directories of their own.

## Not covered

- Type browsing through an installed graph (`beyond install`): the resolution by the edges of the execution projection is implemented and was not run here.
- `workspace.timeout` applied at the next start of a real service: what a starting host reads is unit-tested (`settings.startup.test.mjs`); the host reads it only once its start is wired to it.
- The Packages interface that shows these answers, and any hosted service.
