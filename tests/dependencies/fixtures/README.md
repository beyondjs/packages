# Dependency management fixtures

The workspaces, registry releases, supplied packages and lock that the validations of [dependency management](../../../docs/dependencies.md) exercise. The harnesses copy what they use into a unique temporary directory, write the copy's `.npmrc` with the ports of their in-process registries, and never write these files.

## Registry releases (`registry/<name>/<version>/`)

Each directory is one release: its `package.json` as the registry publishes it (`dependencies`, `peerDependencies`, `deprecated`) and an `index.js`. [`support/registry.mjs`](../support/registry.mjs) packs and serves them; `latest` is the highest stable version published.

| Release | What it is for |
| --- | --- |
| `react` 18.3.1 (depends on `loose-envify`), 19.1.1 | The React of each application, and the two releases a page must not hold together |
| `react-dom` 18.3.1 (peer `react ^18.3.1`, depends on `scheduler ^0.23.2`), 19.1.1 (peer `react ^19.1.1`, `scheduler ^0.26.0`) | The peer requirement that blocks React 19 alone, and the transitive change of `scheduler` |
| `scheduler` 0.23.2, 0.26.0; `loose-envify` 1.4.0; `js-tokens` 4.0.0 | Transitive releases, some shared by several dependents |
| `shared-lib` 1.0.0, 1.1.0, 2.0.0 | A package with two dependents (`@fixture/web` and `chart-kit`); 1.1.0 is published after the installation in the plan cases, 2.0.0 is `latest` and outside every range |
| `chart-kit` 1.0.0 (deprecated), 1.2.0 | Depends on `shared-lib`, React as a peer; 1.2.0 appears after the installation and must not be taken by a targeted plan |
| `old-widget` 1.0.0 (depends on `react ^18.3.1`) | Added to the React 19 application, it puts a second React in its page |
| `@team/tokens` 1.0.0 | A private package, served by the `@team` registry with its token |
| `@team/secret-sdk` 1.0.0 | A package the `@team` registry refuses even with the token (`403`) |

## Workspaces

| Directory | Kind | Members and declarations |
| --- | --- | --- |
| `workspace/` | npm `workspaces` | `apps/web` (`@fixture/web`: React 18, React DOM 18, `shared-lib`, `@fixture/view`; a `./main` module for the browser), `apps/admin` (`@fixture/admin`, two-space indentation: React 18, `chart-kit`, `@team/tokens`, and `@team/secret-sdk` as an optional dependency), `packages/view` (`@fixture/view`: React as a peer and as a development dependency) |
| `hello/` | `beyond.json` | `app` (`@testbed/react-hello`): the declarations of the suite's `testbed/react-hello/app` without its modules: `@beyond-js/widgets ^1.1.0`, `@beyond-js/react-19-widgets ^1.0.0`, React and React DOM 19 |

## Supplied packages (`supplied/`)

`widgets` (`@beyond-js/widgets` 1.1.0) and `react-19-widgets` (`@beyond-js/react-19-widgets` 1.0.0) stand for the packages the toolchain supplies to live development; the harness gives them to the host as its `supplied` setting. No registry of the fixtures publishes them.

## Lock (`locks/workspace.json`)

A hand-written `beyond-lock/2` document of `workspace/` installed from npm (`npm:` keys) and a private registry, whose `digest` is the canonical digest of its other members. The service's unit tests (`service/test/dependencies*.test.mjs`) copy it as the lock of a workspace whose resolutions a stand-in answers; its `inputs` are not those of the fixture, so it is never frozen.

## Expected behavior

- `workspace/` installs: 11 nodes, `@team/secret-sdk` skipped with a `PROVIDER_AUTH_DENIED` warning.
- The preflight of `workspace/` is ready; the preflight of `hello/` blocks both Widgets packages with `PACKAGE_NOT_FOUND` (supplied by the toolchain only), and its installation fails with `GRAPH_INCOMPLETE` and `PACKAGE_NOT_FOUND` through `workspace:app`, until the two packages are declared as members.
