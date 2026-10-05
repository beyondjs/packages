# Workspace resolution fixtures

Checked-in inputs of [`resolution.test.mjs`](../../resolution.test.mjs) (members, ownership, external closure, digest) and [`resolution.peers.test.mjs`](../../resolution.peers.test.mjs) (peers, importers, overrides, development dependencies, lock), which validate `Resolution.workspace` of `@beyond-js/packages/resolution` (the `beyond-workspace-graph/1` document) through the harness [`support/resolution.mjs`](../../support/resolution.mjs). Run each from the Packages directory under BEE Node, with the bootstrap Engine serving this implementation at `BEE_URL` and the loader of `BEE_NODE_DIR` (see [the stage-1 prerequisites](../../../stage-1/README.md#prerequisites)); no watcher is needed:

```sh
BEE_URL=http://localhost:1112 node --import "$BEE_NODE_DIR/register.mjs" tests/local-install/resolution.test.mjs
BEE_URL=http://localhost:1112 node --import "$BEE_NODE_DIR/register.mjs" tests/local-install/resolution.peers.test.mjs
```

The resolver receives parsed manifests, never a directory: the harness reads these files and passes them as members, so nothing here is copied, written or served.

## Layout

| Path | Role |
| --- | --- |
| `registry.json` | The releases the in-process registry of `tests/cdn-resolution/registry.mjs` publishes before the first case of each file. The `@acme/widgets` releases (1.1.4, 1.9.9, 2.9.9, 3.0.0) are decoys: a workspace that provides `@acme/widgets` must never request them, which the test asserts from the registry's log of every request. `dev-tool` declares a development dependency (`dev-helper`) that must never be followed below an importer; `widgets-plugin` declares a peer on the owned name; `leaky` is a release published by mistake with `workspace:` specifiers (two dependencies, by range and by member id, and a peer), which no workspace may bind to its members |
| `members/` | The workspace root for member ids: `members/apps/app/package.json` is the member `apps/app`. Each test picks the members of its scenario |
| `outside/widgets-v2/` | A member outside the root, id `../outside/widgets-v2` |
| `roots/importer/` | A root manifest that declares dependencies of its own: the root importer `.` |
| `roots/overrides/` | A root manifest with `overrides` only: a version pin, a version override of an owned name and an alias override that reaches the registry |
| `roots/repair/` | A root manifest whose `overrides` replace what `leaky` declares: a `workspace:` id (an override of the root may use one), an alias to the registry and a plain range for its peer |
| `standalone/` | A package used as member `.` (the standalone case, and a root that is itself a member) |

## Members

| Id | Name and version | What it exercises |
| --- | --- | --- |
| `packages/widgets`, `packages/widgets-next`, `../outside/widgets-v2` | `@acme/widgets` 1.1.4, 1.2.0, 2.0.0 | Three local versions of one name; each has an external dependency (`@acme/core`) and a peer (`react`) |
| `apps/app` | `app` 1.0.0 | `@acme/widgets ^1.0.0`, React and a development dependency |
| `apps/legacy`, `apps/modern` | 1.0.0 | `~1.1.0` and `^2.0.0` of `@acme/widgets`: two consumers, two local versions |
| `apps/star`, `apps/caret`, `apps/ranged`, `apps/named` | 1.0.0 | `workspace:*`, `workspace:^`, `workspace:^1.0.0` and `workspace:packages/widgets` |
| `apps/unsatisfied` | 1.0.0 | `^3.0.0`, which no member satisfies although the registry publishes 3.0.0 (intentionally invalid) |
| `apps/missing`, `apps/unknown` | 1.0.0 | `workspace:` of a name no member provides and of an id no member has (intentionally invalid) |
| `apps/escape` | 1.0.0 | An `npm:` alias of the owned name beside a plain range of it |
| `apps/conflict` | 1.0.0 | An alias to the registry copy with the member's exact name and version (intentionally invalid: `INSTANCE_NAME_CONFLICT`) |
| `apps/app18`, `apps/app19`, `packages/ui-lib` | 1.0.0 | One member reached from two applications that provide different React releases for its peer |
| `packages/library` | 1.0.0 | A peer that is also a development dependency, and an optional peer |
| `apps/plugged`, `apps/mismatched` | 1.0.0 | A registry package whose peer is the owned name: met by a 1.x member, not by 2.0.0 (intentionally invalid) |
| `packages/cycle-a`, `packages/cycle-b` | 1.0.0 | Two members that require each other |
| `apps/leak` | 1.0.0 | Depends on `leaky`, whose `workspace:` specifiers are refused (`SOURCE_UNSUPPORTED`, intentionally invalid) unless `roots/repair` overrides them |
