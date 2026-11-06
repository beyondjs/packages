# Templates validation: the cloud templates check and compile clean

[The cloud templates](../../templates/cloud/README.md) are what a person starts a source from in the cloud and publishes through Beyond CDN. This validation keeps them true to what this implementation accepts: their catalog describes them exactly, and each one checks and compiles clean the way CDN's source check and preparation run it.

## Fixtures

The templates themselves, `templates/cloud/<directory>/`, read where they are: the catalog test only reads them, and the compile test copies each one into a unique temporary directory, which it removes at the end, on failure as well. Nothing is substituted. The React template's dependencies (`react`, `react-dom`, `@types/react`, `@types/react-dom` and what they depend on) are installed from the npm registry into a directory of the run beside the copy, at the exact versions its manifest names, with install scripts disabled; each installed package becomes one node of the pinned graph with its own root, as CDN extracts them.

## What each file establishes

[catalog.test.mjs](catalog.test.mjs), with Node's test runner and nothing else:

| Case | Established |
| --- | --- |
| the catalog | Protocol `beyond-cloud-templates/1`, an exact semver `version`, templates with unique names and directories |
| description | Each template has exactly the documented members, kind `frontend`, platform `web`, form `module` with entry `main` or form `npm` with entry `.`, plain relative file paths, `package.json` among them |
| files | The template's directory holds exactly the files listed |
| manifest | `package.json` names the catalog's `package` at version `0.1.0`; a module template declares the `source` publication and an npm template none |
| digest | The recorded digest is the digest of the files; a file edited without a new digest fails here, and the message names the digest to record (raise the catalog version with it) |
| digest rule | Path, byte length and bytes in the listed order, the length counted in bytes |

[compile.test.mjs](compile.test.mjs), under BEE Node with the bootstrap Engine serving this implementation. For each template, with CDN's inputs (conditions `{platform: 'browser', environment: 'production'}`, the `esbuild` compiler, format `esm`, confined), following CDN's unit operations `check`, `compile`, `analyze` and `generate` ([support/source.mjs](support/source.mjs)):

| Case | Established |
| --- | --- |
| entry | Opened confined, the package publishes exactly the entry the catalog names |
| semantic check | Every TypeScript file is in one program (the deepest published module directory that holds it, or the package root), and `Diagnostics.check` of each is complete, with no error, no warning, no unresolved types and nothing withheld |
| compilation | Every public module of the template traced together answers no error, and every module and stylesheet of the template in the inventory is generated, confined, with its output under its key |
| preparation | Every item of that inventory, the dependencies' included (React, React DOM, the scheduler), is generated without a diagnostic |

## Run

From the Packages directory. The catalog test needs nothing:

```sh
node --test tests/templates/catalog.test.mjs
```

The compile test needs the prerequisites of [the stage-1 validation](../stage-1/README.md) without the watchers service, and access to the npm registry for the React template's dependencies (bounded at 5 minutes). `BEYOND_ESBUILD` selects the compiler as in the other groups:

```sh
BEE_URL=http://localhost:1112 \
  node --import "$BEE_NODE_DIR/register.mjs" --test tests/templates/compile.test.mjs
```

Expected: `catalog.test.mjs` passes 10 tests (one for the catalog, four per template, one for the digest rule); `compile.test.mjs` passes both templates with their four cases each.

## Not covered

Delivery: nothing is stored, registered or served, and no page loads the outputs; CDN's own tests and acceptance cover registration, release and delivery. The check here follows CDN's unit operations at the revision the test was written against; CDN's job lifecycle, limits and toolchain comparison are not exercised.
