# Preparation validation: a package prepared by the contract it declares

A Beyond package declares how its public modules are compiled: which bundler assembles them, which processors read their sources, and which runtime the composed artifacts are written against. Whoever prepares that package for delivery has to honour that declaration. Preparing it with another compiler produces something the package never described — a widget that registers no element, a source no loader accepts, no stylesheet — and the application that loads it does not work.

This validation prepares an application whose four widgets cover the families the framework controllers support, together with the packages it uses: Widgets (`@beyond-js/widgets`), React Widgets (`@beyond-js/react-19-widgets`), Vue Widgets (`@beyond-js/vue-widgets`), Svelte Widgets (`@beyond-js/svelte-widgets`), the development runtime and the frameworks themselves. Nothing is downloaded, nothing is published, and no development service serves the result: the outputs are written as files and a page of another origin loads them.

## What each step establishes

| Step | Established |
| --- | --- |
| publication | A package that declares Beyond modules or a Beyond bundler and no `beyond.publication` is read as an ordinary npm package **and says so** (`PUBLICATION_UNDECLARED`), instead of being silently prepared with the consumer's compiler. A package that declares the form is read as sources; one that declares nothing of Beyond is not warned about |
| inventory | Every module of the application, of Widgets and of the three framework controllers is reached, with no error diagnostic |
| composition | A module of a package that declares a bundler is compiled by that bundler: the key of the item and the provenance of the output name `@beyond-js/packages/bundlers/ts`, the artifact carries the registration of the element its manifest declares, the runtime is one of its references, and every reference lands in the pinned graph |
| relations | The entry selects the shared sheet of its package with `@fixture/cards/global.css`: its artifact does not import it, its bundle specification names it under `stylesheets` and its outputs relate it as a `style` reference of `./global`. The `html` widget selects `tone.css` the same way and resolves it with `import.meta.resolve`. Every widget's code relates `widget: true` and the `global` sheet, which the inventory reaches from the entry and from the four widgets; composed keys name composition `3` |
| processors | The stylesheet of every family is an output of its module: SCSS, a Vue `<style>` block and a Svelte `<style>` block each compiled, each with a `style` item of its own, beside the stylesheet the package publishes through `exports` |
| packaging | A package that declares the packaging bundler (the development runtime) is compiled by the compiler the consumer selected, as before |
| outputs | Every item generates, with no diagnostic |
| production | The same application prepared for production generates without diagnostics, and a production artifact carries no source map |
| consumption | A page of another origin loads the delivered files alone — no development service is running and no other origin is asked |
| consumption, *family* | The widget renders from the delivered outputs and has the colour its stylesheet gives it, and the outline the shared sheet gives its element from inside its root (`:host`). One step per family, so a family that does not work is named instead of hiding behind the ones that do |
| consumption: selected stylesheets | `tone.css`, which only the `html` widget selects, underlines that card inside its root and no other card; the document links the shared sheet the entry selects and nothing that only widgets adopt |
| consumption: no error | The page reports no error of its own |

## The delivery layout

The outputs are written at the paths of the compiled-module contract, `m/<name>@<version>/modules/<subpath>` and `m/<name>@<version>/styles/<subpath>`, with an `importmap.json` and a `styles.json` of the stylesheets. The import map maps a specifier to the code of a module and a stylesheet only under its specifier with `.css`, as a release's resolution does; the document links the stylesheets a module that is not a widget reaches. That layout is part of what makes a delivered application work: an artifact addresses its companions from its own address — the stylesheet of a module is the `styles` family of the same identity, and the shared sheet of a package is `styles/global` of that package — so a flat directory of files leaves a widget without its stylesheets.

## Run

Prerequisites are those of [the stage-1 validation](../stage-1/README.md), a directory with `playwright-core` installed and Chrome, and the framework packages: `BEYOND_MODULES` names a `node_modules` directory holding `react`, `react-dom`, `scheduler`, `vue`, `@vue/*`, `svelte`, `clsx`, `esm-env` and `@beyond-js/kernel` — an installation built by the command line's acceptance has all of them.

```sh
cd "$PACKAGES_DIR"
BEYOND_MODULES=/absolute/path/to/an/installation/node_modules \
BEYOND_PLAYWRIGHT=/absolute/path/to/a/directory/with/playwright-core \
BEE_URL=http://localhost:1112,… WATCHERS_URL=http://localhost:1120 \
  node --import "$BEE_NODE_DIR/register.mjs" tests/preparation/index.mjs [<output directory>]
```

`BEYOND_SUITE` names another suite location for the Beyond checkouts. An output directory keeps the delivered files for inspection; without it a temporary one is used.

Expected: `15/15 steps passed`.

## Stylesheets of composed modules (`styles.test.mjs`)

Under Node's test runner, with the same prerequisites and the second package in [`fixtures/`](fixtures/README.md): a widget prepared alone reaches the shared sheet of its package, which generates and which its code relates; a widget of a package without `./global` reaches none and its registration asks for none; a composed module that imports a style module without `.css` is `OUTPUT_NOT_FOUND` naming `@fixture/cards/global.css`; one that asks a stylesheet for a value is `STYLE_BINDING_UNSUPPORTED`; composed keys name composition `3`.

```sh
BEYOND_MODULES=… BEE_URL=… WATCHERS_URL=… node --import "$BEE_NODE_DIR/register.mjs" --test tests/preparation/styles.test.mjs
```

## The Svelte family, and what it localizes

This is the family that fails first when the boundary of an ordinary npm package is wrong, so what it establishes is worth naming. The root entry of `svelte` imports `./internal/client/runtime.js` and `./internal/client/context.js` — files **inside** the directory of the public subpath `./internal/client` but not its entry point — so without a plan they are bundled into the root unit while the compiled component imports the public `svelte/internal/client`. Two copies of the runtime state result, and a component mounted from one is not the component the other knows: the page reports `Error rendering widget "card-svelte": TypeError: Cannot read properties of null (reading 'f')`, which is Svelte's internal state read from a second copy of it.

The delivery answers that with a carrier and its facades, which [`Sharing`](../../modules/analysis/pinned/sharing.ts) decides for a package of the pinned inputs, exactly as it does for the installed packages a development environment serves. [The sharing validation](../sharing/README.md) checks that mechanism on small fixtures of its own; this one checks that the packages a real application uses come out working.

React, Vue, Svelte and the plain HTML widget all render with their stylesheets from the delivered files.

## Not covered

Registry publication; a hosted origin; the `system` format in a browser; server rendering; assets declared by a module; the resolution and fetching stages, which are separate modules and separate validations.
