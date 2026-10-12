# Production validation

Runs the [production feature](../../docs/production.md) (`beyond-production/1`) of the real development service started from this checkout through `@beyond-js/packages/service`, as the command line starts it: its supervisor prepares Packages with the bootstrap Engine and starts the host with the development extension, without pairing. Nothing in the service is a stand-in: the catalog of applications, the preview, Packages' readers of publication forms, `exports` and npm's configuration, the compiler and the host's npm are the checkout's and the machine's.

## Run

From the Packages directory, one file at a time (each starts its own service, whose first start compiles Packages with Engine):

```sh
node --test tests/production/packages.test.mjs
node --test tests/production/export.test.mjs
```

Prerequisites: Node 22.21.1 or later and the checkout's dependencies, its bootstrap included (`node_modules/@beyond-js/packages-bootstrap` linked to `bootstrap/`); npm on the `PATH` (the host publishes with it); for `export.test.mjs`, the sources of the development runtime (`BEYOND_RUNTIME`, else the suite's `local-2026` beside this repository) and `playwright-core` with its Chromium (`BEYOND_PLAYWRIGHT`, else the suite's `packages/ui` checkout beside this repository; `npx playwright-core install chromium` installs the browser, `BEYOND_BROWSER_CHANNEL=chrome` uses the installed Chrome instead). `BEE_HTTP_TIMEOUT` is raised to 180 s for the loader of the host unless it is set. Nothing reaches the network: the registry and the CDN are stand-ins of the test process, on loopback ports.

Expected: `2/2` and `6/6` tests passing.

## What each file establishes

| File | Established |
| --- | --- |
| `packages.test.mjs` | Over the `packages` fixture, with the project's `.npmrc` naming a registry of the test and a credential for it: the preflight of `@production/ui` lists its file set and what it leaves out (its `.env`), its exports with their targets and declarations, and the findings that prevent its publication (an export target its `files` leave out, a `workspace:` range, a script that does not run); a `source` package is read as one, with the declaration the `ts` bundler generates for its public module; a private package and an unknown member are refused. `@production/core` is packed (npm's format, its three files), read `not-published`, published by the host's npm with the confirmation repeated, found `published-matching` with the archive's integrity, and a second publication sends nothing (`already-published`); no credential appears in an operation |
| `export.test.mjs` | Over the `web` fixture, whose `beyond.json` declares the frontend target `site/web`: the catalog resolves it; a self-contained export holds the document, every module the page loads (its lazy module included), stylesheets, the declared asset and the manifest, with each file's digest and the source of each package, and holds neither the `.env` beside the sources, nor a path of the machine, nor an address of the service, nor a development map or update route; the `cdn` strategy writes the workspace's modules and references the installed package on a stand-in CDN with the integrity of the digest it answered, under the base `/site/`; an earlier export is replaced only when named, an unknown target and a source that does not build fail with their codes and leave the earlier export untouched; after the service stopped, an independent static host serves the export and Chromium renders it, reloads it, opens a deep route and loads the lazy module, with every request to the static host (and, for `cdn`, to the CDN) and no error |

## Fixtures

[`fixtures/`](fixtures/README.md): the workspaces the services serve. The harness ([support/served.mjs](support/served.mjs)) copies one into a unique temporary directory with its own `BEYOND_HOME`, adds what a fixture cannot hold (the development runtime, the installed package `tiny`, a `.env`, a project `.npmrc`), holds the service as its owner and stops it by detaching. [support/registry.mjs](support/registry.mjs) is the registry of the test (package documents and publications as npm sends them), [support/static.mjs](support/static.mjs) the independent static host and the CDN stand-in, [support/browser.mjs](support/browser.mjs) the browser.

The service's unit tests (`service/test/production*.test.mjs`) reuse the `packages` fixture and these supports, and add stand-ins of their own: a page's description and delivery ([support/page.mjs](support/page.mjs)) and Packages' modules ([support/modules.mjs](support/modules.mjs)).

## Not covered

No public registry, no hosted CDN, no provider of a static host (Netlify, Vercel) and no deployment. A browser without import maps, System.register output and Windows were not exercised.
