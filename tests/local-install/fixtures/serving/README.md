# Serving fixture: an installed workspace handed to a browser

The workspace that [`serving.test.mjs`](../../serving.test.mjs) and [`serving.walk.test.mjs`](../../serving.walk.test.mjs) serve through the routes of the development service: `/resolution.json`, `/importmap.json`, the compiled-module routes and the preview of `@beyond-js/packages/development`. It is installed already: [`execution.json`](execution.json) is a hand-written execution projection (`beyond-execution/1`) of its graph, and `store/` holds the sources of its external nodes where that projection locates them. Nothing is resolved or fetched by the tests, and no `node_modules` directory exists anywhere: every installed package is read from the store, and only through the projection.

The harness, [`support/serving.mjs`](../../support/serving.mjs), copies `root/`, `outside/` and `store/` into one unique temporary directory and reads `execution.json` with `${ROOT}`, `${OUTSIDE}` and `${STORE}` replaced by those copies. Each case names the members its workspace holds; the projection keeps only those members and the edges that name them, as installing them alone would write it, and the Packages workspace is built from them and that projection. A case can also leave a member out of the projection while the workspace holds it (`unlisted`), as a member declared after the workspace was installed. Nothing here is written by a run.

**Generated:** the lattice under `app-l` is written by the harness into the copy of the store and the projection, because its size is what the case tests: `lattice` layers of two packages (`d<layer>a`, `d<layer>b`), each importing both packages of the next layer, so 2^layers paths reach the bottom. `serving.walk.test.mjs` uses ten layers; the harness's `#lattice` shows exactly what is written.

## Members

Every member declares the `web` platform only and compiles its modules in the esbuild packaging mode (`compiler: "esbuild"`), but `lib` and `orphan`, which the `ts` bundler composes on the runtime their bundler names (`bundlers.ts.runtime`), as Widgets and its framework controllers are composed on the development runtime.

| Member id | Package | Module | Imports |
| --- | --- | --- | --- |
| `message-v1` | `@serving/message` 1.0.0 | `./main` | Nothing |
| `../outside/message-v2` | `@serving/message` 2.0.0, outside the root | `./main` | Nothing |
| `app-a` | `@serving/app-a` 1.0.0 | `./main` | `@serving/message/main` (`^1.0.0`), `react` 18.3.1, `shared` |
| | | `./loose` | `loose`, which imports a package its graph does not provide |
| `app-b` | `@serving/app-b` 1.0.0 | `./main` | `@serving/message/main` (`^2.0.0`), `react` 19.1.0, `shared`, `kit`, `ping`, `toolkit` (another registry) |
| `both` | `@serving/both` 1.0.0 | `./main` | `@serving/app-a/main` and `@serving/app-b/main`, so one page reaches both applications |
| `runtime`, `runtime-v2` | `@serving/runtime` 1.0.0 and 2.0.0 | `./bundle`, `./main` | A stand-in runtime package in two local versions; `./main` is its development coordinator and imports `./bundle` |
| `lib` | `@serving/lib` 1.0.0, `ts` bundler composed on `@serving/runtime/bundle` | `./main` | Its runtime only, which it does not declare |
| `app-c` | `@serving/app-c` 1.0.0 | `./main` | `@serving/lib/main`; it declares `@serving/runtime` 1.0.0 |
| `orphan` | `@serving/orphan` 1.0.0, `ts` bundler composed on `@serving/absent/bundle` | `./main` | Its runtime only, which no package of the graph provides |
| `ui-lib` | `@serving/ui-lib` 1.0.0 | `./main` | `react`, a peer (`^18.0.0 \|\| ^19.0.0`) |
| `app-d`, `app-e` | `@serving/app-d` and `@serving/app-e` 1.0.0 | `./main` | `@serving/ui-lib/main`, and `react` 18.3.1 (`app-d`) or 19.1.0 (`app-e`) |
| `app-s` | `@serving/app-s` 1.0.0 | `./main` | `selfy` |
| `peer-lib` | `@serving/peer-lib` 1.0.0 | `./main` | `@serving/message/main`, a peer (`*`) |
| `app-m1` | `@serving/app-m1` 1.0.0 | `./main` | `@serving/message/main` (`^1.0.0`) and `@serving/peer-lib/main` |
| `app-w` | `@serving/app-w` 1.0.0 | `./main` | `broken` and `gone` |
| `app-t` | `@serving/app-t` 1.0.0 | `./main` | The stylesheet `kit-css/theme.css` only, which the build keeps out of the code |
| `app-g` | `@serving/app-g` 1.0.0 | `./main` | `tool` (Git) |
| `app-l` | `@serving/app-l` 1.0.0 | `./main` | `d0a` and `d0b`, the top of the generated lattice |

`root/package.json` declares the membership as a project would (`workspaces`, and the member outside the root through `beyond.workspaces`); the tests give the members to the workspace directly, as the host does after reading that declaration.

## External nodes (`store/`)

| Node | Provider | What it is |
| --- | --- | --- |
| `npm:react@18.3.1`, `npm:react@19.1.0` | `npm` | Stand-ins named `react` that export their version (`… from the store`), so a test tells which one answered. No React is installed with the toolchain, so no fallback could answer for them |
| `npm:shared@1.0.0` | `npm` | A library with `react` as a peer and a stylesheet it imports (`shared.css`) |
| `npm:loose@1.0.0` | `npm` | Imports `phantom`, which it does not declare |
| `npm:kit@1.0.0` | `npm` | Depends on `shared` and not on `react`, so the React `shared` binds below it is provided by the application that reached `kit` |
| `npm:ping@1.0.0`, `npm:pong@1.0.0` | `npm` | Import each other: a walk of the graph must end |
| `npm:selfy@1.0.0`, `npm:deppy@1.0.0` | `npm` | `selfy`'s root module imports its own subpath `selfy/extra`, which imports `deppy`, as `react-dom/client` imports `react-dom` and a sharing facade imports its carrier |
| `npm:broken@1.0.0` | `npm` | **Intentionally invalid**: declares one symbol twice, so it does not build |
| `npm:gone@1.0.0` | `npm` | In the projection only: its sources are missing from the store (`SOURCE_MISSING`, the `incomplete` projection) |
| `npm:kit-css@1.0.0` | `npm` | Publishes the stylesheet `./theme.css` literally |
| `registry-packages-example-test-npm-…:toolkit@2.0.0` | `registry-packages-example-test-npm-1dd7cc74a2fab1c6ac05b563a9260766`, the id Packages' resolution gives `https://packages.example.test/npm` | Addressed under that registry (`/m/<id>/toolkit@2.0.0/…`) |
| `git:github.com/example/tool@0123…` | `git-github-com-example-tool-…` | A Git node, which has no registry address |

## Edges that matter

- `app-a` reaches `@serving/message` 1.0.0 and `app-b` reaches 2.0.0: two local versions of one name, each importer its own.
- `npm:shared@1.0.0` has two `peer` edges for `react`: to 18.3.1 in the context of `workspace:app-a` and to 19.1.0 in the context of `workspace:app-b`. A page of one application binds one of them; a document that reaches both, the page of `@serving/both/main` or the resolution of the whole workspace, cannot give `shared@1.0.0` two addresses for `react` and is refused (`PEER_CONTEXT_AMBIGUOUS`).
- `npm:loose@1.0.0` has no edge: `phantom` is `DEPENDENCY_NOT_INSTALLED`.
- `app-b` reaches `shared` directly and through `kit`: the peer edge's context is `workspace:app-b`, an instance two steps above `shared` on the second path, which is why a walk binds a peer by the chain of instances that reached the importer and not by the one that imported it.
- `ping` and `pong` are a cycle of two edges.
- `ui-lib` has three `peer` edges for `react`: its own, to 19.1.0 without a context (how it binds React developed on its own, as an importer of the workspace), and one in the context of each application that reaches it (`workspace:app-d` to 18.3.1, `workspace:app-e` to 19.1.0). An edge of a context that reached it wins over the edge without one.
- `peer-lib` binds its peer `@serving/message` to the member 2.0.0 without a context and to 1.0.0 in the context of `workspace:app-m1`: the same rule between two local versions.
- No package has an edge to the runtime it is composed on (a bundler's runtime is not a dependency): only `app-c` declares `@serving/runtime`, at 1.0.0.

## Expected behavior

- The resolution of `message-v1`, `../outside/message-v2` and `app-b` has no import for `@serving/message/main`, which two local versions publish, and a scope `/m/@serving/app-b@1.0.0/` giving that application 2.0.0; it maps `react` to 19.1.0 (the peer `shared` binds in the context that reached it, directly or through `kit`), `shared` and `shared.css`, `kit`, `ping` and `pong`, and `toolkit` under its registry. Every address is delivered.
- The resolution of `message-v1`, `../outside/message-v2`, `app-a`, `app-b` and `both` is `422 BUILD_FAILED` with a `PEER_CONTEXT_AMBIGUOUS` diagnostic naming `shared@1.0.0`, `react` and both applications, and a `DEPENDENCY_NOT_INSTALLED` one for `phantom`.
- The runtime that `lib` imports is the runtime of the page: 1.0.0 in the page of `@serving/app-c/main`, whose package declares it, though 2.0.0 is in the workspace too, and so is its coordinator, in whichever order the workspace declares the versions. The page of `@serving/lib/main` has two to choose from and no application that declares one (`RUNTIME_NOT_INSTALLED`), and so does the resolution of the whole workspace (`422`); with `runtime` alone the resolution binds it. `@serving/absent` is in no graph: the page of `@serving/orphan/main` and the resolution of a workspace holding `orphan` say `RUNTIME_NOT_INSTALLED`, and nothing stands in for it.
- The page of `@serving/app-d/main` has React 18.3.1 only, its library included; the pages of `@serving/app-e/main` and of `@serving/ui-lib/main` alone have 19.1.0; the resolution of `ui-lib`, `app-d` and `app-e` together is `422 PEER_CONTEXT_AMBIGUOUS`. Likewise the page of `@serving/app-m1/main` has message 1.0.0 only and the page of `@serving/peer-lib/main` alone 2.0.0.
- The preview of `@serving/app-a/main` has React 18.3.1 and message 1.0.0; the one of `@serving/app-b/main` React 19.1.0, message 2.0.0 and `toolkit` under its registry. Every module of either page comes from the environment, with or without a CDN origin and whatever the selection says; the page of `@serving/both/main` is `409 PEER_CONTEXT_AMBIGUOUS`; `?entry=@serving/message/main` is `409 PREVIEW_ENTRY_REQUIRED` naming both versions, and so is a preview without `entry` of the two versions alone.
- An import without an address is never left to another importer's address: in a page its importer's scope maps it to a module that throws why (`phantom` from `loose`; `tool`, Git, from `app-g`; `broken` and `gone` from `app-w`, which are reported and never listed as served), and a resolution document that would hold one is `422`.
- `selfy/extra` is walked on from `selfy`, so `deppy` is mapped. `kit-css/theme.css` is the stylesheet `./theme.css` of `kit-css`, served, and a member the projection does not know selects nothing (`DEPENDENCY_NOT_INSTALLED`), on the disk, in the toolchain or on the CDN.
- The page and the resolution of `app-l` ask the delivery for each package of the lattice once.
