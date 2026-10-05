# Service fixture: an npm workspace with a member outside its root, served by the real host

The workspace [`service.test.mjs`](../../service.test.mjs) serves with the real host of the development service (`service/host/main.mjs`), installs through `POST /installation` against an in-process fixture registry, and describes through `/state`, `/session`, `/selection` and `GET /installation`. The harness copies `workspace/` and `widget/` side by side into a unique temporary directory, so the member `../widget` is outside the root (the host is started by `service/test/support/host.mjs`), writes the `.npmrc` of the copy (`registry=` the fixture registry, an allocated port) and publishes the two packages of `registry/` to that registry. `supplied/` is given to the host as the packages the toolchain supplies. Nothing here is written by a run.

## Workspace (`workspace/`, root `package.json` with `workspaces: ["app", "../widget"]`)

| Package | Modules | What it is for |
| --- | --- | --- |
| `@fixture/app` 1.0.0 (`workspace/app`) | `./main` and `./extra`, esbuild packaging mode, `node` and `web` | `./main` imports `fixture-text`, which it declares; `./extra` imports `fixture-undeclared`, which it does not. It declares `@fixture/widget@^1.0.0`, which the workspace provides, so the registry is never asked for it |
| `@fixture/widget` 1.0.0 (`widget/`, outside the root) | `./view`, esbuild packaging mode, `web` only | A browser-only module: `/selection` answers it with its preview |

## Registry (`registry/`)

| Package | Published | Used |
| --- | --- | --- |
| `fixture-text` 1.0.0 | From the start | The external dependency of `@fixture/app` |
| `fixture-more` 1.0.0 | From the start | Declared by `@fixture/widget` when a case edits its manifest, which makes the installation stale |

## Supplied (`supplied/`)

| Package | What it is for |
| --- | --- |
| `@fixture/supplied` 1.0.0 (`supplied/tool`) | A package the toolchain supplies: served until the workspace is installed, never after (D8) |
| `@fixture/widget` 0.5.0 (`supplied/widget`) | A supplied copy of a name a member provides: never served, so the name is not ambiguous |

## A declaration with errors (`duplicated/`)

A `beyond.json` workspace whose two packages, `one/` and `two/`, are both `@fixture/twice` 1.0.0, each with a `./main` module (esbuild packaging mode, `node` and `web`). Its own host is started on a copy: the declaration reports `WORKSPACE_INSTANCE_DUPLICATED` (both directories), the service starts and serves both packages anyway, `/state` reports that diagnostic and Packages' `PACKAGE_DUPLICATED`, `/selection` of `@fixture/twice/main` is refused with `PACKAGE_DUPLICATED` naming `one, two`, and `POST /installation` is refused `422 DECLARATION_INVALID`.

## Expected behavior

- Before installing: the installation is `missing`; `/state` lists the two members from their directories (`source: workspace`, no node), `@fixture/supplied` (`source: supplied`) and the runtime the harness gives the host as the toolchain's (`@beyond-js/kernel`, `fixture-text` and `vue`, `source: installation`), and both modules of `@fixture/app` are valid (an external import is the environment's without an installed graph).
- The installation is for the service's own clients: `GET /installation` and its preflight carry no `Access-Control-Allow-Origin` (the compiled-module routes still do), and a `POST /installation` sent as `text/plain` is `415` and one from another origin `403 ORIGIN_REFUSED`, with nothing installed.
- `POST /installation` with a `beyond.json` beside the root manifest is refused `422 DECLARATION_INVALID` (`WORKSPACE_CONFIG_CONFLICT`) and installs nothing.
- `POST /installation` installs: the report is valid, the registry was never asked for `@fixture/widget`, `GET /installation` is `ready`, and the workspace is reloaded with the installed graph: the members carry their nodes (`workspace:app`, `workspace:../widget`), `fixture-text` is a `store` node read from the source store, nothing is supplied, `./extra` is `DEPENDENCY_NOT_INSTALLED`, and Node consumers resolve only the Kernel from the installation: not `fixture-text`, which the graph provides, nor `vue`, which only an adapter of the toolchain needed (D10, A13).
- `/selection` of `@fixture/widget/view` answers `browser: true` and `/preview/?entry=%40fixture%2Fwidget%2Fview`, the development extension being mounted.
- Pointing `../widget` at another copy of the same release (a link to `widget-b`) makes the projection `incompatible` (`member:../widget`), so it is not served as installed; a frozen installation records the new location and is `ready` again, with no registry request.
- Editing the manifest of `../widget` (a new dependency) makes the installation `stale`, through `GET /installation` and `/state`, still served as the installed graph (nothing supplied, only the Kernel from the installation); installing again makes it `ready`, with `fixture-more` in the store.
