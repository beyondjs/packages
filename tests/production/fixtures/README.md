# Production fixtures

Used by [tests/production](../README.md) and by the service's unit tests (`service/test/production*.test.mjs`), which copy them into a unique temporary directory and never write them. Nothing here is compiled by Packages' own build: `beyond.json` of the repository names only its root package.

## packages/

An npm workspace (`package.json`, `workspaces: ["packages/*"]`) whose members the preflight, the archive and the publication read:

| Member | What it is |
| --- | --- |
| `packages/ui`, `@production/ui` 1.2.0 | `files: ["dist", "src"]`, `exports` `.` (`types` `./dist/index.d.ts`, `default` `./dist/index.js`) and `./extra` (`./lib/extra.js`, which `files` leaves out: `EXPORT_TARGET_EXCLUDED`), a `prepack` script (`SCRIPTS_NOT_RUN`), `publishConfig.access: public`, and dependencies on the member `@production/core` (`^1.0.0`) and on the private member `@production/private-util` as `workspace:*` (`DEPENDENCY_WORKSPACE_PROTOCOL`) |
| `packages/core`, `@production/core` 1.0.0 | An ordinary npm package (`index.js`, `greet(name)` answering `Hello <name>, from @production/core`, and a README): packed, installed from its archive by npm and published |
| `packages/private-util`, `@production/private-util` 0.1.0 | `"private": true` (`PACKAGE_PRIVATE`) |
| `packages/beyond`, `@production/beyond` 1.0.0 | Beyond sources (`beyond.publication` `source`, the `ts` bundler), public module `./main` (`main/index.ts`), whose declaration the `ts` bundler generates (`generated`) |

What the cases add to the copy: a `.env` beside `@production/ui` (a file Git ignores, which no archive may hold) and the project's `.npmrc`.

## web/

A `beyond.json` workspace of four packages whose `applications` declare the frontend target `site/web` (`@production/web`, entry `./main`):

| Package | What it is |
| --- | --- |
| `web/`, `@production/web` 1.0.0 | `./main` (`main/index.ts`, `platforms: ["web"]`): renders `Hello browser, from the export` in an `h1.greeting` colored by `main/page.scss` (`rgb(12, 74, 110)`), writes the route, the answer of `tiny` (`TINY!`) and that the badge loaded on `document.body.dataset`, and imports `./lazy` (`lazy/index.ts`, answering `lazy module loaded`) when its button is pressed. `ts` bundler on the development runtime |
| `shared/`, `@production/shared` 1.0.0 | `./text` (`platforms: ["node", "web"]`): `greet(subject)` |
| `art/`, `@production/art` 1.0.0 | `./badge`, compiled in the esbuild packaging mode: an image of the declared asset `badge/logo.svg`, 24 px wide by `badge/badge.css` |
| `vendor/tiny/` | `tiny` 1.0.0, an installed package (`shout(text)`), which the harness moves to `node_modules/tiny` |

What the harness adds to the copy: `runtime/`, the manifest and the exported module directories of the development runtime (`@beyond-js/local-2026`), the member `runtime`; and `web/.env`, a secret no export may contain. Expected: the page renders as described, from the development service and from either export.
