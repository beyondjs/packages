# Identity validation: compiled components are identified by their source, not by where they were compiled

The same package name, version and internal path can come from different sources, and one source can be compiled in any directory. What a compilation generates must follow the identity of the source and not its location. This validation prepares the [fixtures](fixtures/README.md) the way a consumer of `@beyond-js/packages/analysis` and `@beyond-js/packages/generation` does, and loads the result in a browser.

## What each test establishes

| Test | Established |
| --- | --- |
| byte-identical elsewhere | The same pinned application — the fixtures, the four-family application of [the preparation validation](../preparation/README.md), Widgets, the framework controllers, the development runtime and the frameworks — generated from two extraction directories, the second reached through a symbolic link, gives byte-identical outputs, maps, relations and provenance for every unit, in development and production; no output names an extraction root, the temporary or home directory or the working directory, and no map names a source of its own package as outside it. The processors each unit exercised are reported as a matrix, and a processor that no unit reached fails the test |
| stylesheet generated on its own | Each module's stylesheet generated as a separate `style` item from the other directory — what CDN does, one unit per item — selects exactly the scopes the module's code writes |
| same path, other package or module | `view.vue` and `view.svelte` of the widget, of another module of its package and of another package have three different scopes each |
| four origins | The library pinned from npm, from another host and from two registries under one host has four Vue scopes, four Svelte scopes and eight different output keys |
| browser | The application, with its stylesheets generated on their own elsewhere, renders both widgets; in each shadow root the widget's, the panel's and the library's titles keep red, blue and green |
| installed (`installed.test.mjs`) | The development service's compilation of an installed package is kept under the installation it came from: a package reinstalled under the same version with other bytes is compiled again and served, and where several bases hold it the first that holds the exact version is used; another version is `PACKAGE_NOT_FOUND` |

Against the revision before these changes (Packages `20c7a7c`, whose modules are those of `497a185`), the five checks of `identity.test.mjs` fail: a composed module differs when its root is reached through a link, the Svelte class of a stylesheet generated on its own is not the one its code writes, three `view.vue` components share one scope, the four origins share scopes, and in the browser the Vue widget's and the library's titles take the panel's colour.

## Run

Prerequisites are those of [the preparation validation](../preparation/README.md).

```sh
cd "$PACKAGES_DIR"
BEYOND_MODULES=/absolute/path/to/an/installation/node_modules \
BEYOND_PLAYWRIGHT=/absolute/path/to/a/directory/with/playwright-core \
BEE_URL=http://localhost:1112,… WATCHERS_URL=http://localhost:1120 \
  node --import "$BEE_NODE_DIR/register.mjs" tests/identity/identity.test.mjs
BEE_URL=http://localhost:1112,… \
  node --import "$BEE_NODE_DIR/register.mjs" tests/identity/installed.test.mjs
```

Each test file runs under Node's test runner in its own process. Every store, copy, delivered directory, origin and browser it creates is removed when it ends, on failure as well.

## Not covered

The `system` format; the Node platform; declarations (the `types` conditional, which no preparation delivers); a hosted origin; a Git or Snapshots source, which CDN does not accept today. Two sources of one name and version in **one** graph are not prepared: an application pins each name and version from one source, which CDN enforces.
