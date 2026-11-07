# Backends validation: what a Node output writes for the packages a backend depends on

A backend that a host runs from a CDN release depends on ordinary npm packages, most of them CommonJS written for Node: they require builtins by their bare names (`require('util')`) and guard the `require` of packages they can do without (`try { require('supports-color') } catch {}`). This validation checks what [the outputs guide](../../docs/cdn-outputs.md#node-outputs-builtins-and-optional-packages) promises for them, from the outside: the outputs of a preparation for Node and what the delivered backend does when it runs.

## What each step establishes

| Step | Established |
| --- | --- |
| inventory | The application and its packages trace and generate for Node, `{platform: 'node', environment: 'production'}`, with no error, while the optional packages are absent from the graph |
| builtins: Node | Every builtin of a Node output is written with its `node:` scheme, required (`util`, `fs/promises`, `events`) or imported (`os`), and a reference written `node:path` stays as it is; the output's references name them so, and a required builtin is its default export |
| builtins: browser | A browser output leaves a builtin as written, and the analysis warns of it with `NODE_BUILTIN_REFERENCED` |
| keys | `Toolchain.BOUNDARY` is `2`, part of the key of a Node output and not of a browser one |
| optional | A guarded `require` of a package the manifest declares optional (`peerDependenciesMeta` with `optional: true`, or `optionalDependencies`) that the graph does not hold reads a module that throws `MODULE_NOT_FOUND`, and is no reference of the output |
| undeclared | A `require` of a package the manifest does not declare at all is still `DEPENDENCY_UNRESOLVED` |
| execution | The delivered application, run by a separate Node process under BEE Node with the import map the preparation wrote and no installed package, loads its builtins (`require('events')` the class itself) and sees `MODULE_NOT_FOUND` for each absent optional package |

## The fixtures

Four small ordinary npm packages, all version `1.0.0`, checked in under [`fixtures/`](fixtures). [store.mjs](store.mjs) copies them into a temporary directory and pins them as a graph in which every package depends on every other one; the copy is removed at the end and the checked-in files are never written.

| Directory | Public subpaths | What it is |
| --- | --- | --- |
| [`builtins`](fixtures/builtins) | `.` → `src/index.js` (CommonJS) | Requires `util`, `fs/promises` and `events` by their bare names and `node:path` with its scheme, and checks that `require('events')` is the class |
| [`optional`](fixtures/optional) | `.` → `src/index.js` (CommonJS) | Declares the optional peer `absent-peer` and the optional dependency `absent-optional`, neither in the graph, and records the code of each guarded `require`, the second of a subpath (`absent-optional/sub`) |
| [`undeclared`](fixtures/undeclared) | `.` → `src/index.js` (CommonJS) | **Intentionally failing**: guards a `require` of `never-declared`, which its manifest does not declare |
| [`app`](fixtures/app) | `./main` → [`src/main.js`](fixtures/app/src/main.js) | The application and the entry of the run (`@fixture/app/main`): an ES module that imports `builtins`, `optional` and the builtin `os` |

## Run

Prerequisites are those of [the stage-1 validation](../stage-1/README.md), without the watchers service.

```sh
cd "$PACKAGES_DIR"
BEE_URL=http://localhost:1112,… \
  node --import "$BEE_NODE_DIR/register.mjs" tests/backends/index.mjs
```

Expected: `7/7 steps passed`. `BEYOND_ESBUILD` selects another compiler build, as elsewhere.

## Not covered

Deno and a release served over HTTP: CDN's frameworks acceptance (`acceptance/frameworks.mjs` in the CDN repository) prepares real framework packages with the worker's own unit children and runs them with BEE Node's `resolution` adapter and with Deno. A `require` whose argument is not a literal, `__dirname` and `__filename`, and native addons are not supported; the outputs guide says what each one answers.
