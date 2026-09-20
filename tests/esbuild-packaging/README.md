# Trial: the esbuild packaging mode compiled by Packages

A bounded trial of the `esbuild` bundler (`modules/bundlers/esbuild`), which compiles a public module in the esbuild packaging mode: its sources are bundled into one native ES module that keeps its public references bare and registers nothing in a Beyond runtime. The TypeScript bundler remains the runtime-composition mode, with one creator per source file. A module selects either one through the existing `bundler` key of its manifest or the package default.

The trial runs on temporary copies of the suite testbed’s `module-updates` scenario in which each module is given a mode; the testbed itself is not edited. It validates production distribution and development rebuilds separately, and it states what is missing instead of inferring it: **no update is delivered to, or applied in, a running consumer of a packaged module.** A rebuild is not HMR.

## What it checks

| Step | Established |
| --- | --- |
| Compiler identity | The artifact reports the compiler that built it: the fork's version, location, revision and the `assigned` capability that only the fork has; it differs from the `esbuild` this repository depends on |
| Compiler, negative | No selected compiler is `COMPILER_NOT_SELECTED`; an unimportable one is `COMPILER_IMPORT_ERROR`. There is no default and no fallback |
| Upstream selected on purpose | Selecting the installed upstream `esbuild` is reported as such and packages the module too: the packaged ESM path uses no fork-specific option |
| Selection, both directions | `shared` packaged with `app` composed, and the reverse: same artifact addresses, packaged artifacts have no internal modules and no update file, both execute in one consumer, only the composed module registers in the Kernel |
| Production | The `node/production` conditional is minified, references and registers no Beyond runtime, and its source map names the module's sources with their content |
| Development | An edit reported by the real watcher rebuilds the packaged module only; a running consumer keeps the old value, also when it imports again; a restarted consumer observes the change; a source error is `BUNDLE_ERROR` with file and position and publishes nothing; restoring the source restores the hash |

## Run

Prerequisites are those of [the stage-1 validation](../stage-1/README.md): Engine serving this implementation, Engine serving the watchers utility, BEE Node. In the Beyond ESBuild checkout, build the compiler and lay it out as a package first:

```sh
cd "$BEYOND_ESBUILD" && node beyond/prepare.mjs && node beyond/package.mjs
```

Then, from this repository:

```sh
BEYOND_ESBUILD=/absolute/path/to/beyond-esbuild BEE_URL=http://localhost:1112 WATCHERS_URL=http://localhost:1120 \
  node --import "$BEE_NODE_DIR/register.mjs" tests/esbuild-packaging/index.mjs
```

Expected: `8/8 steps passed`. Restart the Engine that serves this implementation after adding or removing a module directory, and allow it to finish compiling before the first run.

The compiler is selected by location in `bundlers.esbuild.processors.bundle.compiler` of the fixture copies: as a `file:` URL in most steps, and in one step as a path relative to the declaring package and as `env:NAME`, whose unset or relative value is refused with `COMPILER_NOT_SELECTED`. Nothing is installed into this repository and its `esbuild` dependency is not changed.

## Not covered

Browser execution of these artifacts; types; styles and HTTP delivery within this run (stylesheet and asset emission and their development delivery are validated separately by [the CDN outputs run](../cdn-outputs/README.md)); the closure identity that the fork's fixtures use; packages whose public modules share private files, which the fork reports as unsupported because Beyond divides code by public module only and nothing is split further; framework source and CommonJS adapters; published-package distribution, which is the separate `exports` bundler; switching the mode of a module that is already running; the unified runtime, since composed modules here run on the installed legacy Kernel.
