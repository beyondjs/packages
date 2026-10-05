# Workspace consumption fixtures

The workspace that `tests/local-install/workspace.test.mjs` and `tests/local-install/workspace-types.test.mjs` consume with and without the execution projection of its installed graph: members by id at their own directories (one outside the root), two local versions of one name, a member reached only through the declaration of another, an alias of a member, a root override, external packages laid out as the source store keeps them, and the hand-written projection that binds them. The harness (`tests/local-install/support/workspace.mjs`) copies `root/`, `outside/` and `store/` to a unique temporary directory, adds a symbolic link to each copy (`root-link`, `outside-link`, `store-link`), and never writes these files. Run the tests from the Packages directory under BEE Node, with the bootstrap Engine serving this implementation:

```sh
node --import "$BEE_NODE_DIR/register.mjs" tests/local-install/workspace.test.mjs
node --import "$BEE_NODE_DIR/register.mjs" tests/local-install/workspace-types.test.mjs
```

## Layout

| Path | Copied to | Content |
| --- | --- | --- |
| `root/` | `<tmp>/root`, the workspace root | An npm workspace (`workspaces`: `app-v1`, `app-v2`, `app-v3`, `app-pinned`, `wrap`, `message-v1`, `unlisted`) whose labeled Beyond extension `beyond.workspaces` names a second `@fixture/message` outside the root, and whose `overrides` select `@fixture/message@2.0.0` below `@fixture/app-pinned`. The tests give the members to `Workspace` themselves, as the service does from the declaration; the root manifest documents what that declaration is. One case writes a small `beyond.json` into the copy to check the legacy `packages` values |
| `root/app-v1/` | | `@fixture/app-v1@1.0.0`: `@fixture/message@^1.0.0`, the alias `message-two` of the member `../outside/message-v2` (`workspace:../outside/message-v2`), `greeting@1.0.0`, `kit@1.0.0`, `plain@1.0.0` and, as a development dependency, `@types/plain@1.0.0` |
| `root/app-v2/` | | `@fixture/app-v2@1.0.0`: `@fixture/message@^2.0.0`, `greeting@2.0.0`, `kit@1.0.0`, and the alias `message-three` of the registry copy `npm:@fixture/message@3.0.0` |
| `root/app-v3/` | | `@fixture/app-v3@1.0.0`: only `@fixture/wrap@^1.0.0`, whose declaration imports `@fixture/message/main` |
| `root/app-pinned/` | | `@fixture/app-pinned@1.0.0`: declares `@fixture/message@^1.0.0`, which the root override replaces with `2.0.0` |
| `root/wrap/` | | `@fixture/wrap@1.0.0`: `@fixture/message@^2.0.0` |
| `root/message-v1/` | | `@fixture/message@1.0.0`, member `message-v1`, with a stylesheet module `./theme` (red) and the declared asset `notice.txt` |
| `root/message-copy/` | | `@fixture/message@1.0.0` again at another directory. It is not a member of the declared workspace nor a node of the projection: the cases that need one version at two directories add it to the members they give |
| `root/unlisted/` | | `@fixture/unlisted@1.0.0`, a member declared after the installation: no node of the projection is it |
| `outside/message-v2/` | `<tmp>/outside/message-v2` | `@fixture/message@2.0.0`, the member outside the root (id `../outside/message-v2`), which also exports `words`, with a stylesheet module `./theme` (blue) and `notice.txt` |
| `store/public/npm/<name>/<version>/<integrity>/files/` | `<tmp>/store/…` | The external sources, as the source store lays them out (a scoped name is one URI-encoded segment: `%40types%2Fplain`, `%40fixture%2Fmessage`). The integrities are placeholders: nothing is fetched or verified |
| `execution.json` | read by the harness | The `beyond-execution/1` projection of that workspace. `${ROOT}`, `${OUTSIDE}` and `${STORE}` are replaced by the directories of the run (`${STORE}` by the link of the store when a case reaches it through a symbolic link), the only substitution of the file; some cases change one edge or node of an in-memory copy. The harness builds the projection with `Execution.from`, so its `lock` and `inputs` are opaque placeholders |

## Public modules

| Module | Imports | Expected |
| --- | --- | --- |
| `@fixture/app-v1/main` | `@fixture/message/main`, `greeting`, `kit`, `plain` | Builds; with the projection its dependencies are `message@1.0.0` (`workspace:message-v1`) and the external nodes of `greeting@1.0.0`, `kit` and `plain`, each with its location |
| `@fixture/app-v2/main` | `@fixture/message/main`, `greeting` | Builds against `message@2.0.0` (`workspace:../outside/message-v2`) and `greeting@2.0.0` |
| `@fixture/app-pinned/main` | `@fixture/message/main` | Builds against `message@2.0.0` although it declares `^1.0.0`: the edge records the override's selection (`override: "2.0.0"`). A copy of the projection without that `override`, or with `^3.0.0`, is `DEPENDENCY_INCOMPATIBLE` |
| `@fixture/app-v1/alias` | `@fixture/message/main` and `message-two/main` | Builds against both versions of one name; its declaration types `words`, which only the second has |
| `@fixture/app-v1/typed`, `@fixture/app-v2/typed` | Types of `greeting` and `kit`; app-v1 also `plain` | Their declarations build through the graph: `kit`'s peer `greeting` is bound to 1.0.0 in the context of `workspace:app-v1` and to 2.0.0 in the context of `workspace:app-v2`; in app-v1, `plain` is typed by `@types/plain`, which an `@ts-expect-error` proves (without those types the directive is unused and the build fails) |
| `@fixture/app-v1/mismatch`, `@fixture/app-v2/mismatch` | `kit`, with a greeting of the other version | Intentionally invalid: each declaration fails with `TS2353`, because in the context of its package `kit` receives the greeting of that package's version |
| `@fixture/app-v3/main` | `@fixture/wrap/main` | Its declaration builds from the declarations of `wrap` and of `message-v2`, which an `@ts-expect-error` proves, without reading any file of `message-v2` |
| `@fixture/app-v1/missing` | `left-pad`, which no edge provides | Intentionally invalid: `DEPENDENCY_NOT_INSTALLED` |
| `@fixture/app-v1/toolchain` | Types of `typescript` and the Node global `process`, which only the toolchain installs | Intentionally invalid with the projection (`TS2307`, `TS2591`); without it the toolchain supplies both and the declaration builds, as before |
| `@fixture/app-v1/mapped` | `local/value`, which the module's `tsconfig.json` maps to `./lib/value.ts` | Its declaration builds: a mapped path is resolved from the module, not looked for as a package |
| `@fixture/app-v1/reference`, `@fixture/app-v1/unreferenced` | `/// <reference types="plain" />`, `/// <reference types="node" />` | The first builds; the second is intentionally invalid (`TS2688`): app-v1 has no edge to `@types/node` |
| `@fixture/unlisted/self`, `/foreign`, `/builtin` | A module of its own package; `greeting`; `node:path` | Not a package of the graph: `self` builds, `foreign` is `DEPENDENCY_NOT_INSTALLED`, and `builtin` fails only for its missing Node types (`TS2307`) |
| `@fixture/message/main` (both versions and the copy), `./theme` | Nothing | Each exports a message naming its version; the theme is a stylesheet module |

## The graph of the projection

- `workspace:app-v1` → `workspace:message-v1`, `workspace:../outside/message-v2` under the name `message-two`, `npm:greeting@1.0.0`, `npm:kit@1.0.0`, `npm:plain@1.0.0` and the `build` edge to `npm:@types/plain@1.0.0`.
- `workspace:app-v2` → `workspace:../outside/message-v2`, `npm:greeting@2.0.0`, `npm:kit@1.0.0`, and `npm:@fixture/message@3.0.0` under the name `message-three`: the registry copy of a member's name, reached through an alias.
- `workspace:app-v3` → `workspace:wrap` → `workspace:../outside/message-v2`.
- `workspace:app-pinned` → `workspace:../outside/message-v2`, with `range: "^1.0.0"` and `override: "2.0.0"`, as the lock writes an edge whose range a root override replaced.
- `npm:kit@1.0.0` has a peer `greeting` provided in two contexts: `npm:greeting@1.0.0` for `workspace:app-v1` and `npm:greeting@2.0.0` for `workspace:app-v2`. Without a context its binding is `PEER_CONTEXT_AMBIGUOUS`.
- `left-pad`, `@types/node` and the toolchain's packages are in no edge, and `@fixture/unlisted` is no node.
