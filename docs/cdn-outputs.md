# Publication forms, analysis and generated outputs for CDN

This guide describes three public modules that a CDN job runs inside an isolated process, after a package graph was pinned and its packages were fetched: `@beyond-js/packages/publication`, `@beyond-js/packages/analysis` and `@beyond-js/packages/generation`. They implement stages 2 and 3 of the [CDN contract](cdn-contract.md). Resolution and fetching are separate modules; these three consume their results as input data and import neither.

Evidence is labelled. **Executed** means the validations in [tests/cdn-analysis](../tests/cdn-analysis/README.md) and [tests/cdn-outputs](../tests/cdn-outputs/README.md) assert it under BEE Node against the bootstrap Engine. Everything else is source only. Nothing here is a CDN acceptance gate, nothing persists an output, and nothing publishes a package to a registry.

## Inputs

| Input | Shape |
| --- | --- |
| `graph` | A `beyond-graph/1` document: `nodes` keyed `origin:name@version`, `edges` of `{from, to, kind, range, name?, context?}`. An edge whose `to` is `null` (a skipped optional dependency) is ignored. A peer edge is followed from the package that reached the dependent (`context`); when one dependent binds a peer differently per context and is reached from none of them, the reference is `PEER_CONTEXT_AMBIGUOUS`. A graph without a valid `digest` is given the digest of its canonical form. |
| `sources` | Node key → extracted package root. A value is the directory, or `{extracted, integrity?}`; the list a fetch answers, whose items carry their `key`, is accepted as it is. The integrity of a package is the one of its node, or the one its fetch verified when the node has none. A package with neither is `INTEGRITY_MISSING`, because no key can be computed for it. |
| `conditions` | `{platform: 'browser' | 'node', environment?: 'development' | 'production'}`. `web` is read as `browser`. |
| `compiler` | The esbuild compiler, selected exactly as in the [esbuild bundler](architecture.md#esbuild-bundler-the-packaging-mode-trial): an installed package name, a `file:` URL, an absolute path through `env:NAME`. There is no default: `COMPILER_NOT_SELECTED`. |
| `format` | `esm` or `system`. |

Every diagnostic is a `{code, message}` value. None of these APIs throws for a problem of its inputs, with one deliberate exception: `Compatibility.key` throws a `TypeError` for inputs that carry a storage scope or any member the contract does not define, because a key computed from other inputs would silently never match.

## Publication form

```ts
import { Publication } from '@beyond-js/packages/publication';
Publication.read(manifest); // {form?: 'source' | 'distribution' | 'npm', version, protocol?, modules?, compiler?, formats?, conditions?, sourcemaps?, manifest?, diagnostics}
```

The discriminator is the manifest field `beyond.publication`, protocol `beyond-publication/1`. A manifest without the field is an ordinary npm package. File extensions, directory layout and the presence of built files are never consulted. A field that is present and invalid selects **no** form (`form` is undefined) and is never treated as ordinary npm.

| Declaration | Result |
| --- | --- |
| `{"protocol": "beyond-publication/1", "form": "source", "modules"?: "<root>"}` | `source`. `modules` is also read by the module manifest finder when `beyond.modules` is absent. |
| `{"protocol": …, "form": "distribution", "compiler": {"name", "version"}, "formats": ["esm" \| "system"], "conditions"?, "sourcemaps"?}` | `distribution`, with `manifest: './beyond-distribution.json'` |
| Field absent | `npm` |
| Anything else | `PUBLICATION_INVALID`, `PUBLICATION_PROTOCOL_MISSING`, `PUBLICATION_PROTOCOL_UNKNOWN`, `PUBLICATION_FORM_INVALID`, `PUBLICATION_AMBIGUOUS` (members of both forms), `PUBLICATION_MEMBER_UNKNOWN`, `PUBLICATION_MODULES_INVALID`, `PUBLICATION_COMPILER_INVALID`, `PUBLICATION_FORMATS_INVALID`, `PUBLICATION_CONDITIONS_INVALID`, `PUBLICATION_SOURCEMAPS_INVALID`, and for the manifest itself `MANIFEST_INVALID`, `PACKAGE_NAME_MISSING`, `PACKAGE_VERSION_MISSING` |

Executed: the fixtures of the CDN `beyond-publication/1` contract (4 valid, 6 invalid) are read with the expected outcome.

### Distribution layout, `beyond-distribution/1`

The declaration has no member that could name a file, so the layout fixes it: `beyond-distribution.json` at the package root.

```json
{
  "protocol": "beyond-distribution/1",
  "package": { "name": "@scope/ui", "version": "2.0.0" },
  "compiler": { "name": "esbuild", "version": "0.25.9" },
  "modules": {
    "./widget": {
      "kind": "module",
      "references": [{ "specifier": "@scope/ui/theme", "kind": "style" }],
      "assets": ["widget/logo.svg"],
      "variants": [{
        "conditions": { "platform": "browser", "environment": "production" },
        "format": "esm",
        "outputs": [
          { "kind": "js", "file": "dist/browser/production/esm/widget.js", "media": "text/javascript", "digest": "sha256-…", "bytes": 512 },
          { "kind": "map", "of": "js", "file": "dist/browser/production/esm/widget.js.map", "media": "application/json", "digest": "sha256-…", "bytes": 900 },
          { "kind": "css", "file": "dist/browser/production/esm/widget.css", "media": "text/css", "digest": "sha256-…", "bytes": 120 }
        ]
      }]
    }
  },
  "assets": { "widget/logo.svg": { "file": "widget/logo.svg", "media": "image/svg+xml", "digest": "sha256-…", "bytes": 97 } }
}
```

`references` carry `eager`, `lazy` or `style`, so a distribution is traced from its manifest. A variant without an `environment` serves every environment. `Distribution.open(root, file)` reads it; `distribution.outputs({subpath, conditions, format})` and `distribution.asset(path)` return the listed files **without compiling**, complete or not at all, after verifying every digest (`DISTRIBUTION_DIGEST_MISMATCH`, `DISTRIBUTION_FILE_MISSING`, `DISTRIBUTION_VARIANT_MISSING` naming the variants that are held, `DISTRIBUTION_PROTOCOL_UNKNOWN`, `DISTRIBUTION_MANIFEST_UNREADABLE`). `Layout` writes the same layout from outputs it is given and returns the `beyond.publication` declaration; it writes no package manifest and publishes nothing. `Digest.of(content)` (`sha256-<base64>`) and `Media.of(file)` are the content digest and media type used throughout.

### Ordinary npm packages

`Exports` resolves a public subpath to a file: subpath keys, the root shorthand, nested conditions **in the order the package wrote them**, `default`, `null` exclusions, fallback arrays and single-`*` patterns; without `exports`, `browser` (string form, browser only), `module`, `main`, then `./index.js`, and any other subpath is a file of the package. The active conditions are `browser` or `node`, `import`, `module`, `default` and the environment; a package that only offers `require` targets is still resolved, and its output adapted.

| Shape | Outcome |
| --- | --- |
| CommonJS entry (React) | Supported. Export names are read with `cjs-module-lexer`, following `module.exports = require('./file')` through every environment branch; the unit exports them and `default` (`module.exports`). A name only one environment defines is `undefined` in the other. |
| ES module entry | Supported, compiled as it is. |
| `require('bare')` inside CommonJS | Supported. It reads a native import of the same bare specifier: a renderer and the library it peers on share one public module. It returns the default when that default carries every named export (an adapted CommonJS package, a Node builtin), the namespace otherwise. |
| `process.env.NODE_ENV` | Replaced by the requested environment, `production` when none is requested; the dead branch is removed. |
| Subpath not exported, `null`, no matching condition | `EXPORT_NOT_FOUND`, `EXPORT_CONDITIONS_UNMATCHED` (add a `default` target or request declared conditions), `EXPORT_TARGET_INVALID`, `EXPORT_TARGET_MISSING`, `EXPORT_TARGET_UNSUPPORTED` (a target that is neither code nor a stylesheet: declare it as an asset) |
| Not supported | The object form of `browser` beyond what esbuild applies to internal files; an ES module whose only export is a default object is returned by `require` as that object; named re-exports of CommonJS are snapshots taken at evaluation, not live bindings; `imports` self-references and `exports` of nested `node_modules`. |

## Analysis

```ts
import { Analysis } from '@beyond-js/packages/analysis';
const inventory = await Analysis.trace({ graph, sources, entries, conditions, declared, compiler, format });
const { inventory, cost, compiler } = await Analysis.measured(request);
```

`entries` are public specifiers (`@scope/app/main`, or `@scope/app@1.0.0/main` when the graph pins the package more than once), optionally `{specifier, target}`; the target defaults to `web` for a browser and `backend` for Node. `format` defaults to `esm`. `compiler` and `format` are required by the inventory itself: both are inputs of every key.

The result is a `beyond-inventory/1` document exactly as the CDN contract defines it, with no other member: `protocol`, `graph` (digest), `digest` (of its own canonical form), `entries`, `items`, `unknown`, `diagnostics` (`severity` `error` or `warning`). Cost and compiler identity are returned beside it by `measured`, never inside it.

| Item | Identity and meaning |
| --- | --- |
| `module` | `module:<node key>/<subpath>`. A reachable public module. `loading` is `eager` when static references alone lead to it from an entry, `lazy` otherwise. |
| `style` | `style:<node key>/<subpath>`. A style public module (an `exports` target that is a `.css` file), or the stylesheet the sources of a module import, which has the subpath of that module and is produced by its unit. Never dropped, never injected into code. |
| `asset` | `asset:<node key>/<path in the package>`. `declared: true` when a module manifest (`assets`, relative to the module directory) or the package (`beyond.assets`) declares it; a file only a `url()` or a source import references is inventoried too. |

`importers` lists who references an item, `targets` the application targets whose entries reach it, and `declared: true` on a module means only a declaration reaches it. An unreachable public module is never opened and never listed.

An `import()` or `require()` whose argument is not a literal is listed in `unknown[]` with its importer, expression and location. When the module manifest (`dynamic: [specifiers]`) or the request (`declared: {importer specifier: [specifiers]}`) declares what it may load, those modules are followed as lazy references and the entry is `DYNAMIC_IMPORT_DECLARED`; otherwise it is `DYNAMIC_IMPORT_UNKNOWN` with an error diagnostic. A declaration adds items; it never changes the inputs of the importer.

Source and npm modules are read by running the selected compiler over one public module in memory (`write: false`, `metafile: true`), through the same `Bundle` and boundary that generation uses, so an inventory lists what a generation produces. The compiled text is dropped: nothing is written and no code is returned. A distribution is read from its manifest and never compiled. Measured on the validation fixture: about 100 ms for 6 in-memory compilations of small modules (`cost.ms`, `cost.compiled`, `cost.read`). Large packages cost what bundling them costs; React's five entry points and `scheduler` trace and generate in a few seconds.

Other diagnostics: `GRAPH_PROTOCOL_UNKNOWN`, `GRAPH_NODE_INVALID`, `GRAPH_EDGE_INVALID`, `ENTRIES_MISSING`, `ENTRY_UNRESOLVED`, `CONDITIONS_INVALID`, `FORMAT_UNSUPPORTED`, `SOURCES_MISSING`, `PACKAGE_NOT_PINNED`, `MANIFEST_UNREADABLE`, `DEPENDENCY_UNRESOLVED`, `MODULE_NOT_FOUND`, `MODULE_ENTRY_MISSING`, `PLATFORM_UNSUPPORTED`, `ASSET_NOT_FOUND`, `ASSET_OUTSIDE_PACKAGE`, `BUNDLE_ERROR`, and the warnings `DEPENDENCY_EDGE_MISSING` and `NODE_BUILTIN_REFERENCED`. A trace that fails before it resolves an entry answers a document with empty `entries`, which the contract does not accept as an inventory: its diagnostics are the result.

## Compatibility key

```ts
import { Compatibility } from '@beyond-js/packages/generation'; // also exported by @beyond-js/packages/analysis
Compatibility.key(inputs);      // 'sha256-<hex>' over Compatibility.canonical(inputs)
```

`inputs` are the ones of the contract: `module` (`origin:name@version/subpath`), `sources` (package integrities), `resolution` (referenced package → node key, only what the code references), `compiler` (`{name, version, configuration}`), `conditions`, `format` (`esm`, `system`, `none`), `output` (`js`, `css`, `asset`). `configuration` is the digest of the compiler options, whether the compiler is the Beyond fork and at which revision, and the `system` transformation. Where the compiler is installed and how it was named are not part of it. A static file is keyed as copied, with no conditions and format `none`. A distribution is keyed by the compiler its declaration names. A source map has no key of its own: it carries the key of the output it describes.

Executed: the key of every traced item equals the key of the output generated for it; compiler version (0.25.9 against 0.28.2), configuration, target, format, resolution and integrity change it; the location of the sources, the spelling that selects the compiler, unrelated graph nodes and member order do not; a storage scope among the inputs is refused; the keys of the contract's inventory fixtures are reproduced.

## Generation

```ts
import { Generation } from '@beyond-js/packages/generation';
const { outputs, diagnostics, warnings, provenance } = await Generation.unit({ item, graph, sources, conditions, format, compiler });
```

One call generates exactly one inventory item and writes nothing. `item` needs `kind`, `package` and `subpath` (the path, for an asset); the resolution its `inputs` recorded is followed as it is. Outputs are `{kind: 'js' | 'css' | 'map' | 'asset', media, code | bytes, size, digest, key, relations}`. `relations` hold the public references that remain bare in the code with the node that satisfies each, `style` references (removed from the code, to be linked by whoever delivers the module), whether the unit produced a stylesheet, the static files an output addresses, and for a map the output it describes. `provenance` holds the compiler (name, version, fork capability and revision) with the options it ran with, the files that were read, and the exact inputs and value of the key.

Essential build errors are always returned as `BUNDLE_ERROR` with file and position, with no output; nothing here knows about entitlements.

- **One public module per unit.** Bare specifiers, and relative imports that land on another public entry of the same package, stay references. Code splitting is off. Executed on fixtures and on the real `react` 19.2.0, `react/jsx-runtime`, `react-dom`, `react-dom/client`, `react-dom/server` and `scheduler`: six units, `renderToString` of a component with hooks returns `<p id="_R_0_">shared:42</p>`, which requires the renderer to use the React the component imported.
- **Formats.** `esm` is the compiler's output. `system` converts that one file with the TypeScript emitter into `System.register`: bare imports become named dependencies, exported bindings stay live, `import()` becomes `context.import()`, and the source map is composed with the compiler's so it still names the original sources. Executed in a minimal System loader, React included.
- **Targets.** `browser` and `node` select resolution conditions, `process.env.NODE_ENV` and minification (production). Node outputs execute under BEE Node through an import map. Browser outputs are generated and inspected, **not executed in a browser**.
- **Styles and static files.** The esbuild processor and generation emit the stylesheet and its map beside the code. A `url()` and a source import of a static file resolve to the file inside the package and are written as `../assets/<path in the package>`, relative to where the compiled-module contract serves a module or its stylesheet, so one output works on every origin.
- **No host path, reproducible bytes.** Every `sources` entry of every map (code and stylesheet, `esm` and `system`, sources, ordinary npm and adapted CommonJS) is renamed under a virtual root, `beyond://<package>@<version>/<path in the package>`; what was generated for the unit is named `beyond://<package>@<version>/~generated/facade.js` (the adapted entry point, which names its target relatively), `~generated/require/<specifier>`, `~generated/asset/<path>` and `~generated/style/<specifier>`, and a file outside the package `~outside/<name>`. `provenance.files` use the same names. The provenance does not report where the compiler is installed or how it was selected, and diagnostics report system failures by code, not by the message that names a directory. Executed: the fixture application and the real React packages, extracted in two different directories, yield byte-identical outputs, maps, digests, relations and provenance in both formats and two sets of conditions, and none contains an extraction root, the temporary directory, the home directory or the working directory. The development processor of the esbuild bundler is unchanged: its maps keep names relative to the module directory.
- **Distributions** are read, verified and returned with the key of their item; a compiler that cannot be imported proves that none runs.

## Development HTTP adapter

With `@beyond-js/artifact-api` 0.2.0, `modules/http` serves `/m/…/styles/<subpath>` (the stylesheet of a packaged module, compiled on request like its code) and `/m/…/assets/<path>` (a file a module manifest or `beyond.assets` declares) under the development policy. A module without a stylesheet, an undeclared file and `/maps/` (development maps are inline) answer `OUTPUT_NOT_AVAILABLE`. The module route is unchanged; `css=true` remains `OPTION_UNSUPPORTED`. Every error of these routes, and of the provisional `/u/` route, is answered as `no-store` JSON without an `ETag`: the contract defines validators for artifact answers (200 and 304) only, so the body is written directly instead of letting Express add a weak tag that a published service does not send. Executed: the module body equals `Delivery.module`, and the contract's conformance rules pass with the style and asset families. A file that only a stylesheet references must be declared to be served in development; published delivery inventories it either way.

## Limits

- TypeScript semantic diagnostics are a separate module; generation reports transpile and bundle errors only.
- Composed (`creators`) artifacts, types, framework source adapters and HMR are not produced here.
- Peer contexts are followed during a trace; one package version reached from two contexts that bind a peer differently is one item, resolved in the context that reached it first.
- The `exports` bundler of workspace packages is unchanged and remains the limited adapter the architecture guide describes.
- The Engine's semantic type check of these modules was not run: its `tsc` distribution does not build the SDK today.

## Validation

```sh
cd "$PACKAGES_DIR"
BEE_URL=http://localhost:1112 WATCHERS_URL=http://localhost:1120 \
  node --import "$BEE_NODE_DIR/register.mjs" tests/cdn-analysis/index.mjs
BEE_URL=http://localhost:1112 WATCHERS_URL=http://localhost:1120 \
  node --import "$BEE_NODE_DIR/register.mjs" tests/cdn-outputs/index.mjs
```

Set `BEYOND_ESBUILD` to select the fork (otherwise the installed `esbuild` is selected by name), `CDN_CONTRACTS_DIR` or `CDN_DIR` for the contract checks, and `CDN_REACT_MODULES` for the real React packages. A step whose prerequisite is missing prints `SKIP` and is not counted.
