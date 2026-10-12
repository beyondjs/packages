# Dependency management: validation

[Dependency management](../../docs/dependencies.md) (`beyond-dependencies/1`) is a feature of the development service's host over the installation of Packages. This group validates it with the real modules and the real host: `Installation` (`@beyond-js/packages/installation`) through its public specifier, and the feature's routes on the host (`service/host/main.mjs`) with the development extension, against in-process registries and copies of [the fixtures](fixtures/README.md). Nothing reaches a public registry. The feature's own units, with stand-ins for the File API and the Packages classes, are `service/test/dependencies*.test.mjs` (`node --test "service/test/*.test.mjs"`).

## Prerequisites and commands

As [the local-install validation](../local-install/README.md): every file runs from the Packages directory under BEE Node, with `BEE_URL` naming the bootstrap Engine that serves this checkout and the utilities, and `BEE_NODE_DIR` a BEE Node checkout. The files that start the host (`service`, `plans`, `hello`) also need `WATCHERS_URL`, the server of the watchers utility, because the host runs the watchers service through it; they start it with the service's own `service/test/support/host.mjs`. Node 22.21.1 or later.

```sh
cd "$PACKAGES_DIR"
BEE_URL=… WATCHERS_URL=… node --import "$BEE_NODE_DIR/register.mjs" --test --test-concurrency=1 "tests/dependencies/*.test.mjs"
```

`BEYOND_HOST_LOG=1` prints the host's log after a file that starts one. The harness removes from its own environment the `NPM_*` variables that would route a name elsewhere, and the copy's `.npmrc` routes every scope the fixtures use to the in-process registries, so a person's npm settings never reach the network.

## Files

| File | Establishes | Harness |
| --- | --- | --- |
| `installation.test.mjs` | `Installation.resolve` answers the graph, the digest of the lock it would write, the metadata requests and the releases of names, writing nothing, and its lock is the one the installation then writes; `install({preferences})` resolves even when the lock covers the inputs, keeps what the preferences pin and tells its phases and requests; `update` with preferences is `INSTALLATION_OPTIONS_INVALID` and offline is `OFFLINE_UNAVAILABLE`; `Installation.releases` tells public, private, denied, missing and unreachable names apart; a resolution or a read that gets no answer ends at its deadline (`RESOLUTION_TIMEOUT`) and a cancelled one at once (`RESOLUTION_CANCELLED`); two instances install one root one after the other | Registries of `support/registry.mjs`; the declaration of `service/workspace` |
| `service.test.mjs` | The `dependencies` capability; the inventory before an installation (declared nodes, a member's name leading to the member, no registry asked) and after it (every node located, a skipped optional dependency `missing`, a shared node once with both dependents, scopes of a node and a member, `SCOPE_INVALID`, `SCOPE_NOT_FOUND`); the preflight of an installable workspace (a private package read with its credential, a denied optional one skipped); a check that is read-only (wanted, latest, available, a deprecation, private and denied access, the lock and manifests untouched) and a check cancelled while a registry holds its answer, answered again by its request identifier | `support/served.mjs`, `support/registry.mjs` |
| `plans.test.mjs` | A targeted plan (`shared-lib` 1.1.0) with its dependents and preserved count, applied: the installed lock is the planned one and every other node keeps its version and integrity, a newer unrelated release is not taken; the same request identifier answers the same application, and another one finds it in place without repeating it; React 19 for one application alone is blocked by `react-dom`'s peer requirement and refused (`PLAN_INVALID`); React 19 with React DOM: requested and transitive changes, both Reacts in their contexts, and a person's edit of the manifest made after the plan kept when it is applied; a duplicated React in one page (`SINGLETON_DUPLICATED`); `VERSION_NOT_FOUND`, `VERSION_NOT_ADMITTED`, `VERSION_UNRESOLVED`, a denied source, and the refusals of malformed requests; a plan made stale by a manifest change fails `PLAN_STALE` and installs nothing | The same |
| `hello.test.mjs` | The React Hello case: what the toolchain supplies is listed as supplied, the preflight blocks `@beyond-js/widgets` and `@beyond-js/react-19-widgets` (`PACKAGE_NOT_FOUND`, supplied only, with the importer, the range and three routes) before an installation is offered, the installation then fails as predicted, and declaring both as members clears it and installs | The same, with `fixtures/supplied` |

## What a pass establishes, and what it does not

A pass establishes the behavior of the feature and of the installation module on one machine, against fixture registries whose metadata the harness controls: it is not the latest release of any real package, nor a hosted registry, nor an installed toolchain (the command line's acceptance), nor the Packages interface or a browser. Concurrent installations through the host's `POST /installation` and an application of a plan are serialized by the installation module per root; the queue of the host's installation routes does not see an application.
