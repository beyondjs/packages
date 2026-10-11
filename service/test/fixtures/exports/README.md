# Export fixtures

`workspace/` is an npm workspace whose sources `exports.archive.test.mjs` and `exports.transfer.test.mjs` freeze with the exports of the development service (`beyond-dev-exports/1`). The cases copy it into a unique temporary directory and never write it.

| Path | Role |
| --- | --- |
| `package.json` | The root package `@fixture/root` 1.0.0, exported as `.`, declaring `packages/*` and the nested member `packages/widgets/demo` |
| `README.md`, `src/index.ts`, `.env.example` | Sources of the root package; `.env.example` is kept, unlike the secrets beside it |
| `packages/widgets` | The member `@fixture/widgets` 1.2.0, which holds the nested member `demo` (`@fixture/demo` 0.1.0): its archive leaves `demo/` out |
| `packages/plain` | The member `@fixture/plain` 2.0.0 |
| `tools` | A package the workspace does not declare: exporting it is `EXPORT_PACKAGE_INVALID` |

Expected: the archive of `.` holds `.env.example`, `README.md`, `package.json`, `src/index.ts`, `tools/package.json` (a directory that is not a member belongs to the root package) and the `packages/` directory without the two members inside it, which are counted as `members`.

What the cases add to the copy, inline, because a checked-in copy would be ignored by Git or mistaken for a real one: `node_modules/`, `.git/` and `.beyond/` directories, files named as secrets (`.env`, `.env.local`, `id_rsa`, `server.pem`, `.npmrc`, `.ssh/config`, `.docker/config.json`), an executable file, a path longer than the 100 bytes of a ustar name, and symbolic links.
