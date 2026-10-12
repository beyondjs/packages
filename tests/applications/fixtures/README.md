# Applications validation fixtures

Used by [tests/applications](../README.md), which copy them into a unique temporary directory and never write them.

| Path | What it is |
| --- | --- |
| `workspace/` | A `beyond.json` workspace of `@applications/shared`, `@applications/web` and `@applications/api` 1.0.0 and the development runtime (`runtime`, which the harness copies in), with one application declared inline, `composition`: the frontend target `web` (entry `@applications/web/main`, `platforms: ["web"]`, which writes a greeting on the page) and the backend target `api` (entry `@applications/api/server`, `platforms: ["node"]`, runtime `node`, ready on `applications api listening`). `@applications/shared/message` (`node` and `web`) is imported by both entries and is no target, nor is `@applications/web/widget`, a module of the web package. `config/applications.json` declares another application, `site`, which the cases name from `beyond.json` to make the branch file-backed. An unrelated field of `beyond.json` (`description`) is there for the cases to check that writes keep it |
| `npm/` | An npm workspace (`workspaces: ["packages/*", "runtime"]`) of `@npm/web` 1.0.0 and the development runtime, beside a `beyond.json` that declares only the application `site` with the frontend target `web` (entry `@npm/web/main`) |
| `standalone/` | A standalone package, `@standalone/site` 1.0.0, without dependencies and without the development runtime, whose module `./main` (`platforms: ["web"]`) writes a greeting on the page. It has no `beyond.json`: the case writes the one that declares its first application, `site` with the frontend target `web` |

Expected behavior: the service builds every module of the `workspace/` and `npm/` workspaces; the catalog of `workspace/` lists `composition` with `web` and `api`, and that of `npm/` lists `site` with `web`; `standalone/` installs as a standalone package and keeps that kind once its `beyond.json` declares `site`. Nothing here is compiled by Packages' own build: `beyond.json` of the repository names only its root package.
