# Preview validation: selection, entry document and updates in a browser

Validates the browser side of the [development contract](../../docs/development-contract.md): the explicit development selection, the preview entry document that routes selected modules to the environment and the others to the CDN, and an update applied to a page that is already running. A second driver validates a project created from the Workspace template with an installed toolchain.

Both drivers use a real headless browser through `playwright-core`, which this repository does not declare. `BEYOND_PLAYWRIGHT` names a directory where it is installed; the installed Chrome is used unless `BEYOND_BROWSER_CHANNEL` names another channel.

## `index.mjs`: the real service, delegated access, a real browser

Prerequisites: those of [the unified-runtime validation](../unified-runtime/README.md) (Engine serving this implementation, Engine serving the watchers utility, BEE Node, the Beyond ESBuild compiler for the development runtime), and the browser.

```sh
BEYOND_PLAYWRIGHT=/absolute/path/to/a/directory/with/playwright-core BEYOND_ESBUILD=/absolute/path/to/beyond-esbuild \
BEE_URL=http://localhost:1112 WATCHERS_URL=http://localhost:1120 \
  node --import "$BEE_NODE_DIR/register.mjs" tests/preview/index.mjs
```

Expected: `9/9 steps passed`.

The workspace is a temporary copy of [`fixture/`](fixture) plus the sources of the development runtime: a browser-only application module (`platforms: ["web"]`) that renders a custom element with a stateful internal module and an adopted stylesheet, and a shared module it imports by bare specifier. The host of the development service runs with the development extension in **delegated** mode, with the public test authority of the contract fixtures. Two stand-ins are part of the driver and are named as such:

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
| events | A completed build lists the browser-only module once, for `web`, and the shared module for `node` and `web`; the visitor, whose grant has no `files.read`, received no `file.*` or `batch.*` event |

What tells an update from a reload here is what a reload destroys: the state of an internal module, the identity of the mounted element, a value stored on `window`, the navigation entries of the page and the requests for the document.

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
- Styles as artifacts, Widgets, declarations and editor type resolution.
- Browsers other than the installed Chrome, and cross-device or shared sessions.
- A change of the selection while a page is open: the page keeps the import map it was loaded with.

## Executed evidence

- [Template and preview validation, 2026-09-20](../../docs/reviews/2026-09-20/template-preview-validation.md): the selection, the preview entry and the first update applied in a browser.
- [Preview bootstrap and runtime distribution, 2026-09-21](../../docs/reviews/2026-09-21/preview-bootstrap-validation.md): a visitor without `session.read`, the runtime installed with the toolchain, and updates in a project created from the template.
