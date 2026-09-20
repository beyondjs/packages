# Validation: publication forms and analysis for CDN

Validates `@beyond-js/packages/publication` and `@beyond-js/packages/analysis`, described in [the outputs guide](../../docs/cdn-outputs.md): the `beyond.publication` discriminator, the resolution of ordinary npm `exports`, and the `beyond-inventory/1` traced from application entries over a pinned graph, inspected before any output exists.

The fixture is built in a temporary directory by [store.mjs](store.mjs), without network access: a Beyond source application and a Beyond source library (an eager module with a stylesheet, a declared logo and a font; a lazy module; a style module; a module only a declaration reaches; an unreachable module; an unknown dynamic import), a hand-written precompiled distribution of the same library, and two CommonJS npm packages shaped like React and its renderer. Its graph is a valid `beyond-graph/1`.

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
