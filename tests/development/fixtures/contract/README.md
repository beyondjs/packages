# Contract fixture: a workspace with installed packages from several sources

The workspace the compiled-module contract of the development service is validated against, by `contract.test.mjs` and `preview.test.mjs` (read [the development tests](../../README.md)). The harness, [`support/served.mjs`](../../support/served.mjs), copies `workspace/` into a unique temporary directory and makes the two directories of `installed/` the `node_modules` of that copy — the only change of layout, because no `node_modules` directory is checked in — so every installed package sits where a package manager puts it and is described by the lockfile of the workspace. Nothing here is written by a run.

## Workspace (`workspace/`)

| Package | Modules | What it is for |
| --- | --- | --- |
| `@fixture/app` 1.0.0 | `./main`, esbuild packaging mode, `web` and `node`; `./theme`, a style module (`theme.css`) | The entry: imports `library` (installed 2.0.0 from npm) and `@fixture/legacy/main`. Declares `tool`, installed from Git. `./theme` has a stylesheet and no JavaScript |
| `@fixture/legacy` 1.0.0 | `./main`, esbuild packaging mode, `web` and `node`, with a stylesheet (`legacy.css`) | Imports `library` and installs its own 1.2.0, from another registry; declares `publishConfig.registry`, so the CDN address of its module names that registry |
| `@fixture/composed` 1.0.0 | `./main` and an internal module, `ts` bundler on the default runtime | A composed module, whose updates the `/u/` route delivers |

`package-lock.json` records where each installation came from:

| Installation | `resolved` | Address in the contract |
| --- | --- | --- |
| `node_modules/library` 2.0.0 | `https://registry.npmjs.org/…` | `/m/library@2.0.0/…` (npm is unprefixed) |
| `legacy/node_modules/library` 1.2.0 | `https://packages.example.test/npm/…` | `/m/<registry id>/library@1.2.0/…`, the id Packages' resolution gives that registry |
| `node_modules/tool` 1.0.0 | `git+ssh://…` | None: a Git installation has no registry address (`SOURCE_UNSUPPORTED`) |

The archive addresses are never fetched: the lockfile only says where the installed files came from. `packages.example.test` is a reserved name that resolves nowhere.

## Installed packages (`installed/`)

- `root/library` (2.0.0) and `root/tool` (1.0.0) become `node_modules/` of the workspace.
- `legacy/library` (1.2.0) becomes `legacy/node_modules/`.

Each exports one ES module whose `version` or `tool` value says which installation answered, which is how the tests tell the two `library` versions apart.

## Expected behavior

- The browser resolution maps `library` to 2.0.0 for every importer and, in the scope `/m/@fixture/legacy@1.0.0/`, to the 1.2.0 of the other registry; `@fixture/app/theme.css` and `@fixture/legacy/main.css` to their stylesheets, and `@fixture/app/theme` to nothing. The node resolution lists the workspace modules that have code and nothing installed.
- The stylesheet of `@fixture/app/theme` is served (`/styles/theme`), and its JavaScript is `OUTPUT_NOT_AVAILABLE`, naming that stylesheet.
- The unprefixed path of `library@1.2.0` and the qualified path of `library@2.0.0` are `PACKAGE_NOT_FOUND`; `tool` is `SOURCE_UNSUPPORTED`.
- The preview gives `@fixture/app/main` the same addresses relative to its document, and, with only `@fixture/app/main` selected, addresses `@fixture/legacy/main` on the CDN under the registry of its `publishConfig`.
