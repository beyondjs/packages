# Validation: generated outputs for CDN

Validates `@beyond-js/packages/generation` and the output half of the esbuild processor and the development HTTP adapter, described in [the outputs guide](../../docs/cdn-outputs.md). It uses the fixture store of [the analysis validation](../cdn-analysis/README.md).

## What it checks

| Steps | Established |
| --- | --- |
| unit (2) | One public module yields code, stylesheet and both maps with media types, digests, keys and relations; bare references stay, a stylesheet reference leaves the code and becomes a relation; `url()` references address `../assets/<path in the package>`; the logo, the font and the style module are their own units |
| esm | Every unit of the inventory is written with an import map and executed by a separate Node process, in a directory with no installed packages: the application, the library, the lazy module and the renderer share one library instance |
| system | `System.register` outputs keep bare named dependencies, `context.import()` and a composed source map that names the original sources, and execute in [a minimal loader](system.mjs), each module evaluated once |
| npm | CommonJS named and default exports, `exports` conditions per platform, the dead `NODE_ENV` branch removed, the peer kept bare, a subpath without a copy of its root module |
| diagnostics | `BUNDLE_ERROR` with file and position and no output; `EXPORT_NOT_FOUND`, `FORMAT_UNSUPPORTED`, `COMPILER_NOT_SELECTED`, `PACKAGE_NOT_PINNED` |
| distribution (3) | The library laid out as a distribution from its generated outputs is read with identical digests while an unimportable compiler is selected; an application that depends on it is traced, generated and executed; a tampered file and a missing variant are refused |
| key (3) | The key of an inventory item is the key of its generated output and not its digest; compiler version, configuration, target, format and resolution change it; the location of the sources, the spelling of the compiler and unrelated nodes do not, and a scope is refused |
| reproducible (1 + 1) | The fixture application, and the real React packages, extracted in two different directories yield byte-identical outputs, maps, digests, relations and provenance in both formats; every map source is `beyond://<package>@<version>/…`; no output contains an extraction root, the temporary directory, the home directory or the working directory |
| react (3) | The real `react`, `react/jsx-runtime`, `react-dom`, `react-dom/client`, `react-dom/server` and `scheduler`: separate units, `renderToString` of a component with hooks under Node (production and development), browser units without Node builtins, and the `System.register` units rendering in the minimal loader |
| http (4) | The module route answers exactly what `Delivery.module` compiles; `/styles/` and `/assets/` serve the stylesheet and the declared logo, whose reference resolves to the asset address; every error answer (400, 404, 422, 501, all families, also for a conditional request) is `no-store` JSON without an `ETag`, while 200 and 304 keep their strong validators; the conformance rules of `@beyond-js/artifact-api` pass with both families |

## Run

```sh
cd "$PACKAGES_DIR"
BEYOND_ESBUILD=/absolute/path/to/beyond-esbuild BEE_URL=http://localhost:1112 \
  node --import "$BEE_NODE_DIR/register.mjs" tests/cdn-outputs/index.mjs
```

Expected: `21/21 passed`. The React steps copy installed packages and download nothing: `CDN_REACT_MODULES` names a `node_modules` directory that holds `react`, `react-dom` and `scheduler`; otherwise the one the Beyond ESBuild checkout prepares for its own ecosystem checks is used when `BEYOND_ESBUILD` is set. Without either they print `SKIP` and the run ends with `17/17 passed`. Without `BEYOND_ESBUILD` the installed `esbuild` is selected by name, and the compiler-version check compares key inputs instead of two compilers.

## Not covered

Execution in a browser; SystemJS itself (the loader here implements the `System.register` protocol only); semantic TypeScript diagnostics; composed artifacts and HMR; a published service, whose adapter belongs to CDN; publication to a registry.
