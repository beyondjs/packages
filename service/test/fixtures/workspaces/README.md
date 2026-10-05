# Workspace declaration fixtures

Workspace roots, members and packages that `Declaration` ([workspace/declaration.mjs](../../../workspace/declaration.mjs)) and `Context` ([context.mjs](../../../context.mjs)) read. The cases copy each fixture to a unique temporary directory and never write the originals. What Git cannot keep is created there by the case: `node_modules` directories (a copy of `vendored`), symbolic links, and malformed manifests, whose content is the input under test.

| Fixture | What it is | What reading it yields |
| --- | --- | --- |
| `classic/` | A `beyond.json` workspace (`packages: ["app", "libs/shared/package.json"]`), with a package `stray/` it does not declare and a directory `notes/` outside any package | Kind `beyond-json`, members `app` and `libs/shared`; `stray/` is not adopted (`CONTEXT_NOT_MEMBER`) |
| `solo/` | A package on its own, with one dependency | Kind `standalone`, the single member `.` |
| `vendored/` | An installed package, copied into `node_modules` directories by the cases | Never a member and never a project |
| `empty/` | A directory with neither a `package.json` nor a `beyond.json` | `CONTEXT_NOT_FOUND`, `CONTEXT_WORKSPACE_INVALID` when named, `MEMBER_NOT_FOUND` when read |
| `npm/` | npm `workspaces` as an array (`packages/*`, `apps/web`) with root `dependencies` and `overrides`; `packages/notes/` holds no `package.json`, `packages/listing.txt` is a file, `tools/stray/` is an undeclared package | Kind `npm`, members `packages/alpha`, `packages/beta`, `apps/web` in that order, no diagnostic |
| `object/` | npm `workspaces` as `{packages: ["packages/*"]}` | Members `packages/one`, `packages/two` |
| `negation/` | `packages/*`, `!packages/excluded`, `!packages/legacy-*`, `!!extra/again` | Members `packages/kept`, `extra/again`; a later `packages/legacy-two` withdraws the negation that matches it |
| `globstar/` | `workspaces: ["**"]`, members `libs/a` and `libs/a/nested`; the root manifest has no version | Members `libs/a`, `libs/a/nested`, never the root nor anything inside `node_modules` |
| `extension/` | `root/` declares `app` in `workspaces` and, in `beyond.workspaces`, `libs/*` and `{path: "../message-v2", version: "2.0.0"}`: `message@1.0.0` inside the root and `message@2.0.0` outside it; `root/vendor/message/` is an undeclared second copy of `message@1.0.0` | Members `app`, `libs/message`, `../message-v2`, valid. The cases derive the duplicate, mismatch and not-found declarations from it |
| `outside/` | `root/` declares `app`, `../shared` and `packages/*`; `repository/` is another repository whose `beyond.json` declares `lib/`; the cases link `root/packages/linked` to `repository/lib` | Members `app`, `../shared`, `packages/linked` (identified by the real directory `repository/lib`). From inside `shared/` the context is `shared` alone, from inside `repository/lib/` it is `repository/`; `--workspace root` reaches the workspace |
| `conflict/` | A `beyond.json` and a `package.json` with `workspaces` in one root | `WORKSPACE_CONFIG_CONFLICT`, no member; below it, `CONTEXT_WORKSPACE_INVALID` |

Run the cases from the repository root:

```sh
node --test "service/test/*.test.mjs"
```

`declaration.test.mjs` covers the forms and the members they yield, `declaration.errors.test.mjs` every diagnostic code with its recovery, `declaration.inputs.test.mjs` the digests, and `context.test.mjs` which workspace a directory belongs to.
