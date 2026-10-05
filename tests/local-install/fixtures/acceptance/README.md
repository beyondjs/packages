# Acceptance fixtures of the local installation

The sources [`acceptance.test.mjs`](../../acceptance.test.mjs) and [`recovery.test.mjs`](../../recovery.test.mjs) install, and the registry they install them from. The harness ([`support/`](../../support)) copies the groups it needs into a unique temporary directory whose name holds a space, side by side as they would be on a developer's disk, and edits only those copies; nothing here is ever written. The same workspace and registry also serve the CDN parity checks of [`tests/cdn-resolution/workspace.test.mjs`](../../../cdn-resolution/workspace.test.mjs).

```text
<temporary directory>/
  workspace/       the npm workspace root (copied from workspace/)
  repositories/    the original repository of a member outside the root (copied from repositories/)
  second/          a second, standalone project sharing the source store (copied from second/)
  private/         a standalone project with a dependency from a registry that requires a credential
  store/           the source store the installations share (created by the installation)
  metadata/        the metadata cache (created by the installation)
```

## `workspace/` and `repositories/`

An npm workspace whose root `package.json` declares `"workspaces": ["apps/*", "packages/*", "!packages/drafts"]`, a development dependency of the root importer (`scheduler ^0.26.0`) and, through the labeled Beyond extension, one member outside the root: `"beyond": {"workspaces": [{"path": "../repositories/message-v2", "version": "2.0.0"}]}`. Every member is a Packages-authored package: `exports` naming its public module's entry point, `beyond.bundler` and a module manifest.

| Member id | Package | Declares | What it shows |
| --- | --- | --- | --- |
| `apps/app` | `@lt/app@1.0.0`, module `./main` | `@lt/message ^1.0.0`, `@lt/banner ^1.0.0`, `@lt/counter-view ^1.0.0`, `react ^19.0.0`, `react-dom ^19.0.0`, `use-store ^1.0.0` | A React 19 application that uses version 1 of `@lt/message` while its dependency `@lt/banner` uses version 2 |
| `apps/app18` | `@lt/app18@1.0.0`, module `./main` | `@lt/message workspace:*`, `@lt/counter-view ^1.0.0`, `react ^18.2.0`, `react-dom ^18.2.0`, `use-store ^1.0.0` | A React 18 application: `workspace:*` selects the highest member version, and the same view binds another React |
| `packages/banner` | `@lt/banner@1.0.0`, module `./banner` | `@lt/message ^2.0.0`, `legacy-scheduler: npm:scheduler@^0.23.0` | A consumer of version 2, and an npm alias whose edge keeps its declared name |
| `packages/counter-view` | `@lt/counter-view@1.0.0`, module `./view` | peer `react >=18.0.0` | A peer that each application binds in its own context |
| `packages/message` | `@lt/message@1.0.0`, module `./text` | nothing | Version 1, inside the root |
| `../repositories/message-v2` | `@lt/message@2.0.0`, module `./text` | nothing | Version 2, in its own repository outside the root; nothing may be written into it |

Two directories are matched and are not members: `apps/notes/` holds no `package.json` (npm skips it), and `packages/drafts/` is excluded by the negated pattern; its dependency `not-published` exists in no registry, so including it by mistake fails the installation.

Expected graph: seven workspace nodes (the six members and the root importer `.`) and seven external releases, `react@18.3.1`, `react@19.1.1`, `react-dom@18.3.1`, `react-dom@19.1.1`, `scheduler@0.23.2` (reached by react-dom 18 and by the alias), `scheduler@0.26.0` (react-dom 19 and the root's development dependency) and `use-store@1.0.0`. `use-store`'s React peer is reached in two contexts with different releases and no context of its own, so resolving it without a context is `PEER_CONTEXT_AMBIGUOUS`, and the graph warns `PEER_CONTEXT_CONFLICT`.

## `second/`

A standalone package (`@lt/second@1.0.0`) declaring `react 19.0.0` and `scheduler ^0.26.0`: installed with the workspace's store, it adds another patch of React and reuses the stored scheduler.

## `private/`

A standalone package (`@lt/private-app@1.0.0`) declaring `@acme/secret ^1.0.0`, which only a registry that requires a credential publishes, and `scheduler ^0.26.0`. The CDN parity checks install it with the `@acme` scope routed to that registry, to show that the private release is stored for the local tenant only and that no credential is written.

## `forms/`

Declarations of every form, read by the discovery cases only: `object/` (npm's `{packages: [...]}` with a leading `./`, and a Beyond pattern `../outside/*` matching `outside/tool`), `beyond-json/` (`beyond.json` `packages`), `standalone/` (one `package.json`), and two intentionally invalid roots: `conflict/` declares members in `beyond.json` and in `workspaces` (`WORKSPACE_CONFIG_CONFLICT`), `duplicated/` gives npm's `workspaces` two packages named `@forms/dup` (`WORKSPACE_NAME_DUPLICATED`). Other refusals (`MEMBER_VERSION_MISMATCH`, `MEMBER_NOT_FOUND`, `WORKSPACE_INSTANCE_DUPLICATED`, `WORKSPACE_RANGE_UNSATISFIED`, `WORKSPACE_PACKAGE_NOT_FOUND`, a package no registry has) are short edits of a copy, written inline in the test.

## `registry/`

The releases the in-process fixture registry ([`FakeRegistry`](../../../cdn-resolution/registry.mjs), loaded by [`support/catalog.mjs`](../../support/catalog.mjs)) publishes: every directory holding a `package.json` is one release, and its other files become the files of its archive. `initial/` is published when a scenario starts; `later/` (React 19.2.0) is published by the freshness case, after a first installation locked React 19.1.1; `refusal/` (`declares-workspace`, a registry package declaring `@lt/message: workspace:^1.0.0`) is published by the CDN parity checks; `private/` (`@acme/secret`) is published by them on a second registry that requires a token.

| Release | Role |
| --- | --- |
| `react` 18.3.1, 19.0.0, 19.1.1; `react-dom` 18.3.1 (peer `react ^18.3.1`), 19.1.1 (peer `react ^19.1.1`); `scheduler` 0.23.2, 0.26.0 | The external closure of the applications |
| `use-store` 1.0.0 (peer `react >=18.0.0`) | An external package both applications reach |
| `@lt/message` 1.5.0, 2.5.0, 3.0.0; `@lt/banner`, `@lt/counter-view`, `@lt/app`, `@lt/app18` 1.5.0 | **Decoys**: higher versions of every local name, satisfying the members' ranges. A correct installation never requests them; a wrong one would select them |
| `later/react` 19.2.0 | A newer release that a lock keeps out until `update` |
| `refusal/declares-workspace` 1.0.0 | A registry package whose `workspace:` dependency `Resolution.pin` must refuse |
| `private/@acme/secret` 1.0.0 | A release only a credential reads |
