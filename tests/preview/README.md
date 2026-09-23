# Preview validation: selection, entry document and updates in a browser

Validates the browser side of the [development contract](../../docs/development-contract.md): the explicit development selection, the preview entry document that routes selected modules to the environment and the others to the CDN, and an update applied to a page that is already running. A second driver applies every kind of update to pages that load ES modules or SystemJS and receive their notifications from the service or from an external emitter, a third updates the shared stylesheet of a package in its widgets, and a fourth validates a project created from the Workspace template with an installed toolchain.

Both drivers use a real headless browser through `playwright-core`, which this repository does not declare. `BEYOND_PLAYWRIGHT` names a directory where it is installed; the installed Chrome is used unless `BEYOND_BROWSER_CHANNEL` names another channel.

## `index.mjs`: the real service, delegated access, a real browser

Prerequisites: those of [the unified-runtime validation](../unified-runtime/README.md) (Engine serving this implementation, Engine serving the watchers utility, BEE Node, the Beyond ESBuild compiler for the development runtime), and the browser.

```sh
BEYOND_PLAYWRIGHT=/absolute/path/to/a/directory/with/playwright-core BEYOND_ESBUILD=/absolute/path/to/beyond-esbuild \
BEE_URL=http://localhost:1112 WATCHERS_URL=http://localhost:1120 \
  node --import "$BEE_NODE_DIR/register.mjs" tests/preview/index.mjs
```

Expected: `10/10 steps passed`.

The workspace is a temporary copy of [`fixture/`](fixture) (see [its README](fixture/README.md)) plus the sources of the development runtime: a browser-only application module (`platforms: ["web"]`) that renders a custom element with a stateful internal module and an adopted stylesheet, and a shared module it imports by bare specifier. The host of the development service runs with the development extension in **delegated** mode, with the public test authority of the contract fixtures. Two stand-ins are part of the driver and are named as such:

- The **gateway** publishes the service under a path prefix and adds the grant of a visitor (`events.subscribe`, `artifacts.read`, and not `session.read`) to every request, as the authenticating proxy of a Workspace administration would. The browser never holds a grant.
- The **origin** answers one path of the compiled-module contract with a module that says `[cdn]`, with the cross-origin header a browser requires. It is not CDN delivery.

| Step | Established |
| --- | --- |
| service | Without a grant the preview, its description, the selection and the update route answer `401` |
| default | Nobody selected: every workspace package is in development, the entry is the only browser module that nothing imports, every address is relative, `GET /preview` redirects relatively, and the document contains neither a grant nor the origin of the service |
| selection | A grant without `build.control` cannot replace it; an unknown name is refused; reading and writing a file of a package that is not selected leaves it as it was; it is stored under `.beyond`, which the tree does not list and no path can write; the module that is not selected resolves to the CDN origin at the workspace version with the published options |
| browser, CDN | Behind the prefix, the page renders `[cdn] Hello preview`, its adopted style is computed, the one CDN request is the expected path and query, and the page reports no error and no refused request |
| browser, environment | With every package selected the same page shows `[environment]`, nothing else is asked of the CDN, and the runtime subscribed to the events through the gateway |
| update | After two clicks, a saved edit of an internal file changes the text **of the running page**: the counter is still 2, the mounted element is the same object, the stateful internal module was evaluated once, the page has one navigation entry and did not navigate, the document was not requested again, and an update of the browser artifact was requested through the gateway |
| update of another package | An edit of the shared module is current through the original import of the application |
| failure and recovery | A source that does not compile changes nothing on the page; its correction is applied, with the state kept |
| declarations | The public declaration of a module is served by its specifier with the hash the build names as its tag, answers `304` to that tag, is refused to a visitor grant, and names the export of the dependency |
| events | A completed build lists the browser-only module once, for `web`, and the shared module for `node` and `web`; the visitor, whose grant has no `files.read`, received no `file.*` or `batch.*` event |

What tells an update from a reload here is what a reload destroys: the state of an internal module, the identity of the mounted element, a value stored on `window`, the navigation entries of the page and the requests for the document.

## `updates.mjs`: updates in ES-module and SystemJS pages, from the service and from an external emitter

Prerequisites: those of `index.mjs`, and SystemJS: `BEYOND_SYSTEMJS` names a directory where the `systemjs` package (6.x) is installed, which this repository does not declare. The service must answer `format=system` on `/m/`, `/u/` and `/importmap.json`.

```sh
BEYOND_PLAYWRIGHT=/absolute/path/to/a/directory/with/playwright-core BEYOND_SYSTEMJS=/absolute/path/to/a/directory/with/systemjs \
BEYOND_ESBUILD=/absolute/path/to/beyond-esbuild BEE_URL=http://localhost:1112 WATCHERS_URL=http://localhost:1120 \
  node --import "$BEE_NODE_DIR/register.mjs" tests/preview/updates.mjs
```

Expected: `10/10 steps passed`.

The service runs in local mode on a port kept for its restart, over a temporary copy of the same fixture. Three pages run the application, each observed through [viewer.mjs](viewer.mjs), which records in the page what its runtime reports:

- `browser/stream`: the preview document, as it registers the runtime (ES modules through the import map, the event stream of the service).
- `browser/relay`: the preview document, whose runtime the driver registers again with `events` set to the event stream of the relay of [the unified-runtime validation](../unified-runtime/relay.mjs), a stand-in external emitter at another origin.
- `browser/systemjs`: [pages/system.html](pages/system.html), served with SystemJS by [system.mjs](system.mjs), which forwards everything else to the service so that the page shares its origin. It does what the preview document does with SystemJS in place of the browser's loader: its `systemjs-importmap` is the service's `importmap.json?target=browser&format=system`, it links the document's stylesheets from `preview/entry.json`, registers the runtime with the session options in `format=system` and imports the entry. Its modules and updates are `System.register` modules converted by the service.

| Step | Established |
| --- | --- |
| service | The preview addresses the entry module in the environment and links its stylesheet in the document; the runtime has a coordinator |
| browser | The three pages render with the stylesheet applied (`body` color) and one link; each runtime is `ready`, platform `web`, environment `browser`, loader `module`, source `stream`; the SystemJS page's runtime is itself in SystemJS's registry as a `format=system` module |
| update | A saved edit changes every page with the internal state, the mounted element and the navigation entry intact; in the SystemJS page the update is a `format=system` `/u/` module in SystemJS's registry |
| invalid build | `invalid` everywhere; the page keeps working with the last code; the correction is applied |
| evaluation failure | `error` with the exception everywhere; the correction is applied with the state kept |
| stylesheet | A new sheet replaces the document's link (one link, addressed by its hash); an invalid sheet leaves the last valid link and color; the correction replaces it |
| stylesheet that fails to load | With the browser refused the new sheet (503 from a route of the test), the previous link and color stay and `error` is reported; once allowed again the next sheet is applied |
| order | Two saves 60 ms apart end in the last one, without errors |
| restart boundary | After the service restarts at the same origin, every page reports `stale` (`EPOCH`); the next build reaches every page and nothing is applied or reloaded |
| lifecycle | `close()` releases each page's connection; nothing but the failures the steps caused was logged |

## `widgets.mjs`: the shared stylesheet of a package, updated in every widget of that package

Prerequisites: those of `index.mjs`, and the sources of the Widgets package, `widgets/widgets/src` of the suite unless `BEYOND_WIDGETS` names them. They are copied into the workspace as the package `widgets` (without `node_modules`), so the service compiles them against the development runtime like the fixture.

```sh
BEYOND_PLAYWRIGHT=/absolute/path/to/a/directory/with/playwright-core BEYOND_ESBUILD=/absolute/path/to/beyond-esbuild \
BEE_URL=http://localhost:1112 WATCHERS_URL=http://localhost:1120 \
  node --import "$BEE_NODE_DIR/register.mjs" tests/preview/widgets.mjs
```

Expected: `5/5 steps passed`. The fixture is [`widgets-fixture/`](widgets-fixture/README.md); the page is the preview document of `@fixture/page/main`, named with `?entry=` because the modules of Widgets are also candidates.

| Step | Established |
| --- | --- |
| service | The preview reaches the three widgets and registers the runtime; the step says whether the session the page is given describes `@fixture/ui@0.1.0/global` (it did not in the recorded run) |
| browser | Each widget of `@fixture/ui` links the shared sheet once inside its root and paints its paragraph with it; the widget of `@fixture/other` links none and keeps the default color; the document links nothing |
| update | An edit of `ui/global.scss` is announced as `styles` for `@fixture/ui@0.1.0/global`, and both widgets of the package link the new sheet from `/u/<hash>/…/styles/global` (one link each) and paint with it; the other widget is unchanged |
| invalid | A broken sheet is reported `invalid`; colors and links of every widget are the last valid ones |
| correction | The corrected sheet is applied to both widgets of the package, the other is unchanged, the runtime reported no `error` and the page logged none |

## `cdn.mjs`: the runtime for a stand-in CDN

A project that does not contain the development runtime asks the CDN for it. `cdn.mjs` compiles the runtime's public modules with the real service, for browsers, and writes them into a directory at the paths of the compiled-module contract (`m/<name>@<version>/modules/<subpath>`), with a `stand-in.json` that says what it is. A static origin over that directory stands in for the CDN in `template.mjs` and in the Workspace administration's browser suite. The service builds development output only, so the stand-in serves the development build where a CDN would serve the production one.

```sh
BEYOND_ESBUILD=/absolute/path/to/the/fork BEE_URL=http://localhost:1112 WATCHERS_URL=http://localhost:1120 \
  node --import "$BEE_NODE_DIR/register.mjs" tests/preview/cdn.mjs /absolute/path/to/a/directory
```

## `template.mjs`: a project created from the Workspace template

It needs no Engine and no loader: everything that compiles is an installed toolchain, built as the command line's acceptance builds it, which installs the development runtime beside Packages.

```sh
BEYOND_TEMPLATE=/absolute/path/to/the/template BEYOND_TOOLCHAIN=/absolute/path/to/an/installation \
BEYOND_TEST_CDN_DIRECTORY=/absolute/path/to/the/directory/of/cdn.mjs \
BEYOND_PLAYWRIGHT=/absolute/path/to/a/directory/with/playwright-core node tests/preview/template.mjs
```

Expected: `10/10 steps passed`.

The driver copies the template into a temporary directory outside every checkout, checks that no file names a checkout, a home directory or another repository, and then does what the template's README and AGENTS.md say: it starts `beyond run` with `BEYOND_SERVICE_EXTENSIONS` and `BEYOND_CDN_ORIGIN`, reads the preview description and the state, opens the preview, edits a text and observes the update applied to the open page with its state kept and no navigation, adds the sibling package of the instructions with its bare import, checks that an edit of the sibling changes its artifact and not the application's, provokes an undeclared dependency and a source error, replaces and clears the selection with the documented requests, runs `beyond run <module>` on the browser module, and interrupts the command. The CDN origin is a stand-in serving the two runtime modules written by `cdn.mjs`.

The sibling package `@project/shared` is written by the driver, not copied from a fixture, on purpose: that step reproduces the edit a person makes by following the template's AGENTS.md, and its manifest copies the `bundlers` entry of the project's own `packages/app/package.json` at run time, as those instructions say, so it follows whichever template is under test. It is three short files (`package.json`, `text/module.json` with `"platforms": ["web"]`, and a one-line `text/index.ts` exporting `greeting`) plus two edits to `beyond.json` and the application manifest, all in the `AGENTS.md` step of [template.mjs](template.mjs), and they only ever exist in the temporary copy of the template. A checked-in copy would pin a `bundlers` entry that the template owns.

## What it does not cover

- CDN delivery, the proxy of a Workspace administration, visitor links and their revocation: both are stand-ins here.
- A runtime delivered by a real CDN, or published anywhere: the runtime is installed from its checkout by the acceptance installer, and its browser modules come from the stand-in.
- Stylesheets of a widget itself and the sheets a widget selects with `.css`: `widgets.mjs` covers the shared sheet of a package, and `updates.mjs` the stylesheet links of the document. Framework widgets (React, Vue, Svelte) are the command line's `web` acceptance.
- A SystemJS page served by the service itself: the page is a test fixture, and the preview document is an ES-module page.
- Browsers other than the installed Chrome, and cross-device or shared sessions.
- A change of the selection while a page is open: the page keeps the import map it was loaded with.

## Executed evidence

- [Template and preview validation, 2026-09-20](../../docs/reviews/2026-09-20/template-preview-validation.md): the selection, the preview entry and the first update applied in a browser.
- [Preview bootstrap and runtime distribution, 2026-09-21](../../docs/reviews/2026-09-21/preview-bootstrap-validation.md): a visitor without `session.read`, the runtime installed with the toolchain, and updates in a project created from the template.
