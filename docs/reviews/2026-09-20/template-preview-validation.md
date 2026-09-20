# Template and preview validation, 2026-09-20

Executed evidence for three things: the development selection and the preview entry of the [development contract](../../development-contract.md), the application of an update to a page that is already running, and a project created from the Workspace template (`beyond-web` 0.1.0) compiled, served and rendered by Packages. It records what was run, with which versions, and what was observed. Statements marked **source** were read and not executed; **gate** names what remains and the missing piece.

Paths are variables: `$SUITE_DIR` is the directory that holds the component checkouts, `$BEE_NODE_DIR` the BEE Node checkout, `$TOOLCHAIN` an installation built by the command line's acceptance installer, `$PLAYWRIGHT_DIR` a directory where `playwright-core` is installed.

## Environment

| Component | Version |
| --- | --- |
| Node.js | 22.21.1, macOS |
| Packages | 0.0.1, working tree of `feature/next` over `bc91ad1` with the changes this record validates |
| Development runtime (`local-2026`) | 0.1.0, working tree over `169d712` with the platform and options settings |
| Compiled-module contract (`@beyond-js/artifact-api`) | 0.2.0 |
| Command line (`@beyond-js/cli`) | 0.1.0, unchanged |
| Engine (bootstrap of the implementation) | `beyond` 1.4.1 |
| Kernel | 0.1.12 beside the Packages checkout; 0.1.14 in the installed toolchain, which is what the template run resolved |
| Beyond ESBuild (compiler of the development runtime) | 0.28.2 |
| Browser | Chrome 153.0.8010.52, headless, driven by `playwright-core` 1.63.0 |
| Template | `beyond-web` 0.1.0, working tree of a repository without commits |

Two Engine servers were already serving the implementation (1112) and the watchers utility (1120) for the checkout runs. The template run used neither: the installed toolchain started its own bootstrap.

## What was run

```sh
cd "$SUITE_DIR/packages"

# 1. Contract fixtures and the unit tests of the service: no Engine
node --test contracts/development/test/fixtures.test.mjs
node --test "service/test/*.test.mjs"

# 2. The development contract against its implementation (stand-in delivery)
BEE_URL=http://localhost:1112 node --import "$BEE_NODE_DIR/register.mjs" tests/development/index.mjs

# 3. The preview in a browser: real service, delegated access, development runtime
BEYOND_PLAYWRIGHT="$PLAYWRIGHT_DIR" BEYOND_ESBUILD="$SUITE_DIR/beyond-esbuild" \
BEE_URL=http://localhost:1112 WATCHERS_URL=http://localhost:1120 \
  node --import "$BEE_NODE_DIR/register.mjs" tests/preview/index.mjs

# 4. Regression of the Node consumers of the same runtime and service
BEYOND_ESBUILD="$SUITE_DIR/beyond-esbuild" BEE_URL=http://localhost:1112 WATCHERS_URL=http://localhost:1120 \
  node --import "$BEE_NODE_DIR/register.mjs" tests/unified-runtime/index.mjs
BEYOND_ESBUILD="$SUITE_DIR/beyond-esbuild" BEE_URL=http://localhost:1112 WATCHERS_URL=http://localhost:1120 \
  node --import "$BEE_NODE_DIR/register.mjs" tests/unified-runtime/service.mjs

# 5. The template, with an installation built from the current components
node "$SUITE_DIR/cli/acceptance/install.mjs" "$TOOLCHAIN"
BEYOND_TEMPLATE="$SUITE_DIR/workspace-template" BEYOND_TOOLCHAIN="$TOOLCHAIN" BEYOND_PLAYWRIGHT="$PLAYWRIGHT_DIR" \
  node tests/preview/template.mjs

# 6. The accepted behavior of the command line, against the same installation
cd "$SUITE_DIR/cli" && node acceptance/index.mjs "$TOOLCHAIN"
```

## Results

| Run | Observed |
| --- | --- |
| 1. Fixtures | 47 tests, 47 passed: every fixture of the schema, the new `selection`, `preview`, `build.platforms` and `event.selection-changed` documents included, and the scenario checks |
| 1. Service unit tests | 8 tests, 8 passed |
| 2. Development contract | `20/20 steps passed`: the 15 earlier steps and the 5 of the new `preview` group |
| 3. Preview in a browser | `9/9 steps passed` |
| 4. Unified runtime | `6/6 steps passed` and `7/7 steps passed`: Node consumers ignore the artifacts announced for `web` |
| 5. Template | `10/10 steps passed`, against an installation rebuilt after the last code change |
| 6. Command line acceptance | `48/48 steps passed`, exit 0, against that same installation: the two changes under `service/` keep the accepted behavior |

### Selection and preview entry (runs 2 and 3)

- Until somebody selects, `GET /development/selection` answers `explicit: false` with every package of the workspace. Reading a file, writing it, creating another and the build that followed left it unchanged; only `PUT` and `DELETE` changed it, and each change was announced once as `selection.changed`.
- The stored selection is `.beyond/development/selection.json` under the served root, with a `.beyond/.gitignore` of `*`. A second service object over the same root read it back. The scanned tree did not list it, no event named it, and `PUT /files/content/.beyond/…` answered `403 PATH_FORBIDDEN`.
- A grant with `inspect.read` read the selection and was refused its replacement (`403 GRANT_CAPABILITY`); the preview and its description needed `artifacts.read`; without a grant every new route, and the update route `/u/`, answered `401`.
- With `@fixture/shared` left out of the selection, its module was addressed at `<CDN origin>/m/@fixture/shared@0.1.0/modules/text?target=browser&format=esm&env=production&min=true&sourcemap=external&types=false&css=false`, and the modules in development at `../m/…?target=browser&format=esm&env=development&min=false&sourcemap=inline&types=false&css=false`.
- Without `BEYOND_CDN_ORIGIN` the description said so in `cdn.reason`, the runtime was `unresolved` at its resolved version with no address, the import map left it out and `PREVIEW_CDN_UNSET` was reported. No address was invented.
- The document contained neither a grant, the word `Bearer`, nor the origin of the service.

### Rendering and updates in a browser (run 3)

The page was opened at `http://127.0.0.1:<port>/environments/env_shop0001/visitor/preview`, a gateway that adds the grant of a visitor and forwards to the service in delegated mode. It redirected to `preview/`, rendered `[cdn] Hello preview | Count: 0` with the computed background `rgb(12, 74, 110)` of the adopted stylesheet, and the stand-in origin received exactly one request, the expected path and query. With every package selected the text was `[environment] Hello preview | Count: 0` and nothing else was asked of that origin.

After two clicks (`Count: 2`), `web/main/view.ts` was edited on disk. Observed without any navigation: the text became `[environment] Hello preview | Clicks: 2`; the element was the same object that was stored on `window` before the edit; the stateful internal module had been evaluated once; `performance.getEntriesByType('navigation')` had one entry; no `framenavigated` event and no second request for the document occurred; an update of `@fixture/web@0.1.0/modules/main` with `target=browser` was requested through the gateway; a third click gave `Clicks: 3`. An edit of the other package was current through the original import after the next click (`[environment] Hi preview | Clicks: 4`). A source that did not compile left the page working (`Clicks: 5`), and its correction was applied (`Total: 5`). The completed builds listed the browser-only module once, for `web`, and the shared module for `node` and `web`; the visitor stream, whose grant has no `files.read`, carried no `file.*` or `batch.*` event.

This is an update applied by the development runtime to a running page. It is not a reload, an iframe refresh or a rebuilt artifact, and the run asserts the difference.

### Template (run 5)

From a copy of the template in a temporary directory outside every checkout, with no file that names a checkout, a home directory, the suite or a cross-repository link (12 files):

1. `BEYOND_SERVICE_EXTENSIONS=@beyond-js/packages/development BEYOND_CDN_ORIGIN=<origin> beyond run`, the command of the README, printed `development server started`, the workspace and the endpoint. `/state` reported `@project/app/main` `valid`; `/preview/entry.json` had no diagnostics, the application from the `environment` and `@beyond-js/kernel/bundle` from the `cdn` at 0.1.14; `updates.reason` said that nothing applies updates to the running page.
2. `/preview/` rendered `Hello, Beyond`, the button's computed background was `rgb(30, 64, 175)`, a click gave `1 click`, and the page reported no error and no refused request. The CDN origin was a stand-in that served the browser build of the Kernel installed with the toolchain at the path of the contract: no Beyond CDN exists to ask.
3. An edit of `texts.ts` was rebuilt on save. The page that was already open still showed the previous title two seconds after the rebuilt artifact was available, and showed the new one after a reload. That is the behavior the README states, and it is not HMR.
4. The sibling package of AGENTS.md (`packages/shared`, `@project/shared/text`, registered in `beyond.json`, declared in the dependencies of the application, imported by its bare specifier) was picked up without restarting the server. The description listed both modules from the environment; the application artifact kept `from '@project/shared/text'` and did not contain the text of the other package; the page showed `Hello from shared, Beyond`. Editing the sibling changed its entity tag and left the application's as it was.
5. Removing the declared dependency was reported as `DEPENDENCY_NOT_DECLARED` by the description, with the application still the entry; a source error was reported as `TRANSPILE_ERROR`, `/state` said `invalid` and the module route answered `422` with no older output; both recovered.
6. The documented selection requests replaced and cleared the selection, and the package left out was addressed on the CDN origin at its workspace version. `beyond run @project/app/main` exited 1 with the reason that the module is not built for Node. Ctrl+C (SIGINT) stopped the server and the endpoint stopped answering.

## Findings

- A composed `web` artifact of the `ts` bundler executes in Chrome against the published Kernel browser build (`bundle.browser.mjs`) loaded through an import map. Executed, first time.
- The development runtime needed no change to run in a browser. What it needed was to know which of the announced artifacts is its own: builds ran for Node conditions only, so a browser-only module was announced as invalid. Builds now name the platform, the runtime filters by it, and the preview document passes the browser options the updates are requested with.
- The update route `/u/` was not guarded in delegated mode: the guard listed `/m/` only. It now requires `artifacts.read`.
- The event stream gave every subscriber the source events, with file paths and actors. A preview visitor needs `events.subscribe` for updates, so a grant without `files.read` no longer receives them.
- `/state` described a browser-only module as one that does not build. It now builds it for browsers when it does not declare Node.
- When the application stopped building, the module it imports became the only candidate entry and was previewed in its place. A browser module that does not build is now a candidate too, and the entry chosen before the error is kept.
- Packages compiles TypeScript modules only. No Widget metadata and no style artifact exists for the `ts` bundler (**source**: the module route refuses `css=true`; a stylesheet exists only in the esbuild packaging mode), so the template renders a standard custom element with a constructable stylesheet and says so.

## Gates that remain

| Gate | Missing piece |
| --- | --- |
| HMR in a project created from the template | The development runtime is not distributed: it is a private workspace package under a provisional name, compiled by a fork compiler located through an environment variable. Until it is published or provided by the environment, and the `runtime` setting of generated projects is decided, a template project uses the published Kernel, which has no coordinator for this service. Proved here only for a workspace that contains the runtime sources |
| A real CDN origin | Nothing is hosted. Every preview needs at least the runtime of its artifacts from `BEYOND_CDN_ORIGIN`, served cross-origin. Validated against a stand-in. The resolution of what a CDN-delivered external package itself imports needs the `beyond-resolution/1` document, which no route serves |
| The authenticating proxy, visitor links, revocation of an open preview | Owned by the Workspace administration. The gateway here is a stand-in that proves the document, modules, session, events and updates work behind a prefix with a grant the browser never holds |
| Widgets and style artifacts | Not produced by Packages |
| Editor type resolution of bare imports, declarations | Not set up by the template, not tested |
| Codex following the template's instructions | Not executed: the driver performs the steps of AGENTS.md literally |
| Template upgrade leaves an existing project unchanged | No upgrade mechanism exists; not tested |
| Browsers other than Chrome, Windows, Docker | Not exercised. The Workspace project environment image was not rebuilt or run with these changes |

## Engineering proposals in this change

These were chosen to make the requirement executable and are not owner-approved policy: the route names `/development/selection`, `/preview/` and `/preview/entry.json`; `inspect.read` to read and `build.control` to replace the selection, instead of a new capability, because the grant contract enumerates capabilities in another repository; the default of every workspace package in development until somebody selects; the persistence under `.beyond/` in the working copy; `BEYOND_CDN_ORIGIN` and the published default options for CDN addresses; the default entry rule and `?entry=`; the `main` coordinator convention; the `platform` field of build results; the source-event filter for grants without `files.read`; `BEYOND_SERVICE_EXTENSIONS`; and the template's `template.json` schema and location.
