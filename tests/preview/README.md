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

- The **gateway** publishes the service under a path prefix and adds the grant of a visitor (`session.read`, `events.subscribe`, `artifacts.read`) to every request, as the authenticating proxy of a Workspace administration would. The browser never holds a grant.
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

## `template.mjs`: a project created from the Workspace template

It needs no Engine and no loader: everything that compiles is an installed toolchain, built as the command line's acceptance builds it.

```sh
BEYOND_TEMPLATE=/absolute/path/to/the/template BEYOND_TOOLCHAIN=/absolute/path/to/an/installation \
BEYOND_PLAYWRIGHT=/absolute/path/to/a/directory/with/playwright-core node tests/preview/template.mjs
```

Expected: `10/10 steps passed`.

The driver copies the template into a temporary directory outside every checkout, checks that no file names a checkout, a home directory or another repository, and then does what the template's README and AGENTS.md say: it starts `beyond run` with `BEYOND_SERVICE_EXTENSIONS` and `BEYOND_CDN_ORIGIN`, reads the preview description and the state, opens the preview, edits a text, adds the sibling package of the instructions with its bare import, checks that an edit of the sibling changes its artifact and not the application's, provokes an undeclared dependency and a source error, replaces and clears the selection with the documented requests, runs `beyond run <module>` on the browser module, and interrupts the command. The CDN origin is the stand-in above, serving the browser build of the Kernel installed with the toolchain at the path of the contract.

## What it does not cover

- CDN delivery, the proxy of a Workspace administration, visitor links and their revocation: both are stand-ins here.
- Updates for a project that uses the published Kernel, which is what the template does: the development runtime is not distributed, so the template driver asserts the opposite, that the running page is **not** updated and that a reload shows the edit.
- Styles as artifacts, Widgets, declarations and editor type resolution.
- Browsers other than the installed Chrome, and cross-device or shared sessions.
- A change of the selection while a page is open: the page keeps the import map it was loaded with.
