# Validation: publication forms and analysis for CDN

Validates `@beyond-js/packages/publication` and `@beyond-js/packages/analysis`, described in [the outputs guide](../../docs/cdn-outputs.md): the `beyond.publication` discriminator, the resolution of ordinary npm `exports`, and the `beyond-inventory/1` traced from application entries over a pinned graph, inspected before any output exists.

The fixture packages are checked in under [`fixtures/`](fixtures) and described [below](#fixtures): a Beyond source application and a Beyond source library (an eager module with a stylesheet, a declared logo and a font; a lazy module; a style module; a module only a declaration reaches; an unreachable module; an unknown dynamic import), a hand-written precompiled distribution of the same library, and two CommonJS npm packages shaped like React and its renderer. [store.mjs](store.mjs) copies them into a temporary directory as extracted packages, without network access, and builds the pinned graph that joins them, a valid `beyond-graph/1`.

## Fixtures

Each directory under `fixtures/` is one extracted package, copied unchanged into the temporary store by `Store.create()` (or `Store.copy()` for the distribution); the store is removed at the end of the run and the checked-in files are never written. [The outputs validation](../cdn-outputs/README.md) and CDN's delivery tests (`test/delivery/support/compile.mjs` of the CDN repository, which imports [store.mjs](store.mjs) from the Packages directory it is given) use the same store.

| Directory | Package | Entry modules and relevant files | Intended behavior |
| --- | --- | --- | --- |
| [`app`](fixtures/app) | `@fixture/app@1.0.0`, Beyond sources (`beyond.publication.form: source`) | `./main` → [`main/index.ts`](fixtures/app/main/index.ts); `./admin` → `admin/index.ts` | `./main` is the traced entry: it imports `@fixture/ui/widget`, the style module `@fixture/ui/theme`, `fake-react` and `fake-react-dom`, dynamically imports `@fixture/ui/chart`, and has one dynamic import of an unknown specifier (`'@fixture/plugins/' + name`, the intended `DYNAMIC_IMPORT_UNKNOWN`). `./admin` is never reached |
| [`ui`](fixtures/ui) | `@fixture/ui@2.0.0`, Beyond sources | `./widget` → [`widget/index.ts`](fixtures/ui/widget/index.ts) with `label.ts`, [`widget.css`](fixtures/ui/widget/widget.css), `logo.svg`, `fonts/fixture.woff2` and [`module.json`](fixtures/ui/widget/module.json) declaring both assets; `./chart`, `./theme` (`theme/index.css`), `./extra`, `./unused` | `./widget` is eager with a stylesheet whose `url()` references reach the declared logo and font; `./chart` is lazy; `./theme` is a style public module; `./extra` is reached only when a check adds a declaration; `./unused` is never reached. The font is a placeholder of 23 bytes, not a real WOFF2 file: only its identity and address are checked |
| [`ui-distribution`](fixtures/ui-distribution) | `@fixture/ui@2.0.0` as `beyond.publication.form: distribution` (compiler `fixture-compiler@3.2.1`, format `esm`) | [`beyond-distribution.json`](fixtures/ui-distribution/beyond-distribution.json), `dist/widget.js`, `dist/widget.css`, `widget/logo.svg` | A hand-written precompiled distribution, read from its manifest and never compiled. The manifest states the `sha256` digest (base64) and byte size of each listed file, and must be changed together with them. `./extra` is deliberately absent from it |
| [`fake-react`](fixtures/fake-react) | `fake-react@18.0.0`, CommonJS npm | `.` → `index.js` choosing `cjs/react.production.js` or `cjs/react.development.js` by `process.env.NODE_ENV`; `./jsx-runtime` with a `browser` condition | `exports` conditions and environment branches. `server.js` throws, on purpose: the `react-server` condition must never be selected. `useState` throws without a renderer, which is how a second copy of the library shows |
| [`fake-react-dom`](fixtures/fake-react-dom) | `fake-react-dom@18.0.0`, CommonJS npm | `.` → `index.js`, `./client` → `client.js` | A renderer with `fake-react` as a peer, which must stay one shared module |

The JSON files are kept compact, without a final newline, exactly as the former generator wrote them, so that the move to checked-in files left every source byte, and every key or digest computed from it, unchanged. Short invalid edits (for example `export const extra = ;` in the outputs validation) and the graph variations of each check stay inline in the checks.

## What it checks

| Step | Established |
| --- | --- |
| publication | Absent field is `npm`; `source` and `distribution` are read; eleven invalid declarations select no form |
| npm exports | Nested conditions in package order, per platform and environment, patterns, `null`, `require`-only targets, legacy fields, actionable refusals |
| trace, modules | Reachable modules across packages with `eager`/`lazy`, `targets` and `importers`; unreachable modules absent; nothing is written into the store |
| trace, styles and assets | Style module, the stylesheet of a module, the declared logo and font, `url()` references |
| trace, dynamic imports | `unknown[]` with location and `DYNAMIC_IMPORT_UNKNOWN`; a declaration turns it into `DYNAMIC_IMPORT_DECLARED` and adds a lazy, `declared` item without changing the key of the importer |
| trace, keys | No compiled code in the document; every key is the digest of its inputs; format, environment and platform change it, the shape of `sources` does not; a storage scope is refused |
| trace, npm | One item per subpath and condition; a peer is followed in its context and is ambiguous without one |
| trace, distribution | Read from its manifest, never compiled (`cost.read`, `cost.compiled`) |
| trace, negative | Missing sources, unpinned dependency, missing integrity (and the one a fetch verified), no compiler, no entries, unknown format, unknown entry, unknown module, unknown graph protocol |
| contract (3 steps) | `Publication.read` agrees with the fixtures of the CDN publication contract; the fixture graph validates and the contract's graphs are read, peer context included; four traced inventories validate against `beyond-inventory/1`, and `Compatibility.key` reproduces the keys of the contract's inventory fixtures |

## Run

Prerequisites are those of [the stage-1 validation](../stage-1/README.md): the bootstrap Engine serving this implementation and BEE Node. No watcher is used.

```sh
cd "$PACKAGES_DIR"
CDN_DIR=/absolute/path/to/cdn BEE_URL=http://localhost:1112 \
  node --import "$BEE_NODE_DIR/register.mjs" tests/cdn-analysis/index.mjs
```

Expected: `12/12 passed`. The contract steps need `CDN_CONTRACTS_DIR` (the contracts directory) or `CDN_DIR` (its parent checkout), with the dependencies of that checkout installed, because its validator is used; without them they print `SKIP`, are not counted, and the run ends with `9/9 passed`. `BEYOND_ESBUILD` selects the Beyond fork of the compiler; otherwise the installed `esbuild` is selected by name.

## Not covered

Resolution and fetching, which produce the inputs; real registries; packages larger than the fixtures (the React packages are traced by [the outputs validation](../cdn-outputs/README.md)); persistence of an inventory, which belongs to its consumer.
