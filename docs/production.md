# Production: package publication and the web export

The development service prepares what leaves the developer's machine (`beyond-production/1`): the registry archive of a package, its status at a registry and its publication with the host's own npm, and the complete web export of a frontend execution target, which a static host serves as it is. The Packages interface drives these routes with its pairing token, and the command line with the service's local credential (`beyond pack`, `beyond publish`, `beyond build`). The work that takes long runs as [long operations](service.md#long-operations) of the host (`beyond-dev-operations/1`): a durable record under `.beyond/operations` that names the host running it, steps with their state and times, `operation.changed` and the transient `operation.progress` on the event stream, and one operation per request identifier (`Idempotency-Key`).

The feature lives in [service/host/production](../service/host/production/index.mjs). It is enabled, and claims the capability `production: 1` in `/session`, on a service that mounts the development extension (whose catalog of applications, declarations and preview it uses) and does not verify delegated grants; anywhere else its routes answer as if nothing were mounted.

## Routes

| Route | Answer |
| --- | --- |
| `GET /production/packages/:member` | `200` the preflight of a package |
| `POST /production/packages/:member/archives` | `202 {operation}` `production.pack` |
| `POST /production/packages/:member/status {registry?, archive?}` | `202 {operation}` `production.status` |
| `POST /production/packages/:member/publish {archive, registry, access, tag?, confirm}` with `Idempotency-Key` | `202 {operation}` `production.publish` |
| `POST /production/exports {application, target, strategy?, destination?, base?, replace?}` with `Idempotency-Key` | `202 {operation}` `production.export` |
| `GET /production/exports`, `GET /production/exports/:id` | `200 {protocol, exports}` (newest first), `200 {export}` |

`:member` is a member's directory relative to the root, encoded (`packages%2Fui`; the root package is `%2E`, since a URL parser removes a `.` segment), or its package name (`%40scope%2Fui`) when one member has it. A started operation answers `202` with `Location: /operations/<id>`; the same `Idempotency-Key` for the same kind answers the operation it created (`200`). Bodies are JSON (`415 CONTENT_TYPE_UNSUPPORTED` otherwise) and every answer is `no-store`.

| Code | Status | Meaning |
| --- | --- | --- |
| `MEMBER_NOT_FOUND`, `MEMBER_AMBIGUOUS`, `MEMBER_INVALID` | 404, 409, 422 | No member with that directory or name; several with that name; one outside the root, reached through a link or whose manifest does not name it and its version |
| `REQUEST_INVALID`, `IDEMPOTENCY_KEY_REQUIRED`, `IDEMPOTENCY_KEY_INVALID` | 400 | A field is missing or malformed; a publication or an export without a request identifier; any request whose identifier is not 8 to 128 letters, digits, `_`, `.`, `:` or `-`, the rule of every feature of the host |
| `ARCHIVE_NOT_FOUND`, `ARCHIVE_CHANGED` | 404, 409 | No archive of that package with that identifier (or it expired); its bytes are not the ones packed |
| `CONFIRMATION_MISMATCH` | 422 | The confirmation does not repeat the name, version and registry being published |
| `VERSION_EXISTS`, `REGISTRY_REFUSED`, `REGISTRY_UNAVAILABLE`, `REGISTRY_UNVERIFIABLE` | 409, 403, 503, 502 | Reasons a publication sent nothing (below) |
| `PUBLISH_FAILED`, `PUBLISH_UNKNOWN` | 502, 504 | npm failed and the registry does not hold the version; npm did not answer and the registry could not be read |
| `APPLICATIONS_UNAVAILABLE`, `APPLICATION_NOT_FOUND`, `TARGET_NOT_FOUND`, `TARGET_NOT_FRONTEND`, `TARGET_UNRESOLVED` | 503, 404, 404, 422, 422 | The export's target cannot be resolved |
| `EXPORT_DESTINATION_INVALID`, `EXPORT_DESTINATION_CONFLICT` | 400, 409 | The destination is not one of the workspace's own; it holds something an export may not replace |
| `EXPORT_STRATEGY_UNSUPPORTED`, `EXPORT_GRAPH_INCOMPLETE`, `EXPORT_PRODUCTION_UNAVAILABLE` | 422 | The strategy cannot be honoured; a module the page needs has no source; a module builds no production output |

A refusal of a request is its answer; a failure of the work is the operation's `error` (`{code, message, details?}`), its step failed with the same reason.

## The preflight of a package

What a publication would publish, read before anything is packed or sent:

```json
{
	"protocol": "beyond-production/1",
	"member": "packages/ui",
	"name": "@scope/ui", "version": "1.2.0", "private": false,
	"publication": { "form": "npm", "diagnostics": [] },
	"registry": { "url": "https://registry.npmjs.org", "source": "default", "access": "restricted", "tag": "latest", "declared": [] },
	"files": { "count": 4, "bytes": 5632, "list": ["dist/index.d.ts", "dist/index.js", "package.json", "src/index.ts"], "excluded": { "secrets": [".env"], "ignored": ["lib/extra.js"], "links": [], "members": [], "internal": [] } },
	"exports": [{ "subpath": ".", "declared": "exports", "target": "./dist/index.js", "included": true, "types": { "state": "included", "provenance": "package", "file": "./dist/index.d.ts" } }],
	"dependencies": [{ "name": "@scope/core", "range": "^1.0.0", "type": "dependencies", "member": "packages/core", "version": "1.0.0", "private": false }],
	"findings": [{ "code": "SECRETS_EXCLUDED", "severity": "warning", "message": "…", "paths": [".env"] }],
	"ready": true
}
```

- **Publication form**: Packages' `Publication` reader (`beyond-publication/1`): `source` or `distribution`, `npm` for a manifest without the declaration, `null` for one that cannot be read. A Beyond distribution manifest is not by itself a package an npm consumer runs.
- **Registry**: `publishConfig.registry`, else the registry npm's configuration gives the package's scope (project, workspace, user and global rc files and the environment, read by Packages' `ProvidersSettings`), else npm's default (`source`: `publishConfig`, `configuration`, `default`). Access is `publishConfig.access`, else npm's default (`restricted` for a scoped name); the tag `publishConfig.tag`, else `latest`; `declared` names which of them the package's `publishConfig` sets.
- **Files**: a dry run of the archive (below), with what it leaves out by reason.
- **Exports**: each public subpath (`exports`, `main` without it, or the Beyond public modules a package declares through module manifests), its target for a Node consumer and whether the archive holds it (`browser: {target, included}` when a browser's differs), and its declaration: the `types` condition or the root's `types`/`typings` (`included`, `excluded`, provenance `package`); for a `source` package, the declaration Beyond generates from its sources (`generated`, asked of the development extension's declarations; `DECLARATION_PRODUCER_MISSING` for a bundler without a `types` conditional, `DECLARATION_INVALID` for sources that do not check, `unknown` with `DECLARATION_TIMEOUT` when it was not produced within its bound); otherwise `absent`. Nothing is synthesized.
- **Dependencies** that point at the workspace, as a registry consumer installs them (`dependencies`, `peerDependencies`, `optionalDependencies`).

| Finding | Severity | When |
| --- | --- | --- |
| `PACKAGE_PRIVATE` | error | `"private": true`: npm refuses to publish it |
| `PUBLICATION_*` | error (`PUBLICATION_UNDECLARED`: warning) | An invalid `beyond.publication`, or Beyond modules without one |
| `EXPORT_TARGET_EXCLUDED` | error | A public subpath resolves to a file the archive leaves out |
| `DISTRIBUTION_MANIFEST_EXCLUDED` | error | A `distribution` without its `beyond-distribution.json` |
| `DEPENDENCY_WORKSPACE_PROTOCOL`, `DEPENDENCY_LOCAL`, `DEPENDENCY_PRIVATE` | error | A range npm publishes as written that no registry resolves (`workspace:`, `file:`, a path), or a dependency on a private member |
| `DEPENDENCY_RANGE_UNSATISFIED` | warning | The member's version is outside the declared range |
| `DECLARATION_EXCLUDED`, `MAIN_EXCLUDED`, `BIN_EXCLUDED` | warning | A file the manifest names that the archive leaves out (npm would add `main` and `bin`; this archive does not) |
| `SECRETS_EXCLUDED`, `FILE_SUSPICIOUS` | warning | Files named like credentials were found and left out; a file the archive holds is named like one |
| `SCRIPTS_NOT_RUN` | warning | `prepack`, `prepare`, `prepublishOnly`…: no package script runs |
| `DEPENDENCY_MEMBER` | info | A dependency on a member, which must be published first |

The package is `ready` when no finding is an error.

## The archive: `production.pack`

npm's archive format: a gzipped tar whose entries are the package's files under `package/`. The file set is the one of [the source exports](portable.md#beyond-dev-exports1), decided by their [Archive](../service/host/exports/archive.mjs) and never copied: what the registry publication would hold (`files`, else `.npmignore`/`.gitignore` with Git's semantics), never `node_modules`, `.beyond`, `.git`, links, other members or secrets. Entries are in the archive's order, files only, `0644` or `0755`, modification times, owners and groups 0; the tar is compressed at level 9 with the operating-system byte of the gzip header fixed, so equal sources give equal bytes with the same Node. No package script runs.

The result is `{archive: {id, member, name, version, size, integrity, shasum, files, excluded, created}}`: `integrity` is `sha512-<base64>` and `shasum` the SHA-1 in hexadecimal, as npm records them. The archive is kept as `.beyond/production/archives/<id>.tgz` (`arc_<24 hex>`) with its record, for 24 hours, where no file route lists or changes it; `.beyond/.gitignore` is written when it is missing.

## Registry status: `production.status`

One `GET <registry>/<name>` (a scoped name as `@scope%2fname`) with this machine's credential for that registry when npm's configuration has one, within `BEYOND_REGISTRY_TIMEOUT` (15 s, body included); a redirect is not followed. The result `{status: {state, registry, name, version, checked, archive?, published?, http?, reason?}}` is bound to the registry, the name, the version, the archive's content and when it was read:

| State | Meaning |
| --- | --- |
| `not-published` | The registry has no such name, or the name without this version |
| `published-matching` | The version is there and its `dist.integrity` (or `dist.shasum`) equals the archive's |
| `version-exists-different` | The version is there with other content |
| `unverifiable` | The version is there and nothing compares it (no archive named, no digest recorded), or the answer cannot be read |
| `refused` | The registry refused this machine's credentials (401, 403) |
| `unavailable` | No answer within the bound, no connection, or a failure of the registry (5xx, 429) |

A credential is presented only to the registry it belongs to and is never written to a record, an event, a log or an answer.

## Publication: `production.publish`

The request names the archive, the registry, the access, the tag and a confirmation that repeats `{name, version, registry}` exactly (`CONFIRMATION_MISMATCH` otherwise). The work, in steps:

1. `check`: the registry's status. The same content already there ends the work, `already-published`, with nothing sent; other content under the version is `VERSION_EXISTS` and nothing is ever overwritten; `refused`, `unavailable` and `unverifiable` send nothing either (`REGISTRY_REFUSED`, `REGISTRY_UNAVAILABLE`, `REGISTRY_UNVERIFIABLE`).
2. `publish`: the archive's bytes are compared with its record (`ARCHIVE_CHANGED`), and the host's npm publishes it: `npm publish <archive> --registry <url> --access <access> --tag <tag> --ignore-scripts`, run from the workspace root (whose `.npmrc` applies as it does to npm there) with the service's environment, no input, in a process group of its own, within `BEYOND_PUBLISH_TIMEOUT` (120 s; then `SIGTERM`, and `SIGKILL` 5 s later). Its output is kept in memory, its last lines only, with credentials redacted.
3. `verify`: the registry is read again, and it decides the outcome: the archive's content there is `published` (`reconciled: true` when npm failed or did not answer); nothing there after a failure of npm is `PUBLISH_FAILED` (or `REGISTRY_REFUSED` for npm's `E401`, `E403`, `ENEEDAUTH`, `EOTP`), and nothing was published; a registry that cannot be read after npm failed is `PUBLISH_UNKNOWN` (`details.outcome: unknown`). After npm succeeded, a registry that does not show the version yet is still `published`, with `verified: false`.

A publication is never sent twice: the request identifier answers the operation it created, one that a stop of the service interrupted is `interrupted` with an unknown outcome, and every publication starts by reading the registry. The result is `{outcome, verified?, reconciled?, status, npm: {exit, code?, expired, output}}`.

## The web export: `production.export`

The complete web export of a frontend execution target: a directory a static host serves as it is.

| Field | Meaning |
| --- | --- |
| `application`, `target` | The execution target, resolved by the catalog of applications (`beyond-applications/1`); only a `frontend` one has a web export |
| `strategy` | `self-contained` (default): every output the page needs is written. `cdn`: the workspace's own modules (and the toolchain's) are written, and the installed packages are referenced on the configured CDN origin, each pinned by the integrity of the digest the CDN answered for it |
| `destination` | A directory inside the workspace root, relative to it; without it, the service's own `.beyond/production/exports/<application>/<target>` |
| `base` | The path the export is served under, `/` by default |
| `replace` | The identifier of an earlier export of the same target that the destination holds |

The steps:

1. `target`: the catalog resolves the target (its entry module, its kind; a declaration error is `TARGET_UNRESOLVED` with its diagnostics) and the destination is checked.
2. `graph`: the page is described as a preview of its entry, with every package of the workspace in development and the externals of the strategy (`environment` or `cdn`), whatever the person's development selection is.
3. `outputs`: the page's graph is walked from the entry with the **production** output of each module (`{platform: 'web', environment: 'production'}`, minified, without a map), following the description's import map and the scope of an importer that reaches another version. What each module imports (its runtime, its public dependencies, eager or lazy, the stylesheets it selects) is walked in turn; its stylesheet and the declared assets its code or stylesheet addresses relative to itself (`../assets/…`) are taken with it. The development coordinator a preview registers is never reached, so no update connection enters the export.
4. `write`: the files are written in `.beyond/production/staging/<id>`, moved into the destination with renames once complete (an earlier export moves aside and is removed after), and recorded under `.beyond/production/exports/<id>.json`. A journal (`<id>.json`) names the host that writes the export before anything is staged, and the destination once the moves begin: a service that stopped between them puts the earlier export back into an empty destination, or records the new one already in place, when it starts again, so a destination never ends up empty. The operation itself is then `interrupted`, its outcome read from the destination's manifest. A starting host recovers only what a host that is gone staged: the export another live host on the same root writes (a `beyond build` beside a person's service) is left alone, and what was staged without a readable journal is removed only once nothing of it changed for a minute.

| File | What it is |
| --- | --- |
| `index.html` | The document: the import map, the stylesheets of the modules the entry reaches without crossing a widget, and the import of the entry; the browser's native import maps are the loader |
| `m/<identity>/modules/<subpath>.js` | The production output of each module, at its compiled-module path (`/m/@scope/app@1.0.0/modules/main`), with the extension a static host serves it by; a package of a registry other than npm is under its registry id, as its address names it |
| `m/<identity>/styles/<subpath>.css` | Stylesheets |
| `m/<identity>/assets/<path>` | Declared assets a module addresses |
| `beyond-export.json` | The manifest (`beyond-web-export/1`) |

Every address in the document and the import map is under `base` (`/m/…` by default), so a deep route a static host answers with `index.html` loads the same modules; an address a module writes relative to itself resolves the same way from its file. Nothing else enters the export: no development route, update connection, pairing, token, secret (an asset named like one is `EXPORT_SECRET_REFUSED`) or path of the machine. An import without an address (`EXPORT_UNRESOLVED`), one on another origin in a self-contained export (`EXPORT_REMOTE_REFUSED`), a module that does not build (its diagnostics) or builds no production output fails the export, which writes nothing.

**Without a destination** the export goes to `.beyond/production/exports/<application>/<target>`, in the service's state directory, which ignores itself for Git and which neither the watchers nor the File API see, so an export never lands beside the sources; an earlier export of the same target there is replaced without being named. A person copies it from there, or names a destination of the workspace.

**The destination** is refused (`EXPORT_DESTINATION_INVALID`) when it is absolute, has an empty, `.` or `..` segment, goes through `.beyond`, `node_modules` or `.git`, is or contains a member's directory, lies inside a member other than the root package, or reaches anything through a symbolic link. One that holds files is written only in place of an earlier export of the same target named by `replace`; anything else is `EXPORT_DESTINATION_CONFLICT`, whose `details.replace` names the earlier export of the same target when there is one. The check is repeated before the move, so two exports never write over each other.

**The `cdn` strategy** needs a CDN origin (the `cdn.origin` setting, or `BEYOND_CDN_ORIGIN`) and a workspace that was not installed: an installed workspace serves every node of its graph itself, which is `EXPORT_STRATEGY_UNSUPPORTED`. Each address on the CDN is checked as a preview checks it ([the preview's externals](development-contract.md)); one the CDN does not hold, cannot be bound to or did not answer for has no address, and the export fails with that reason.

**The manifest**:

```json
{
	"protocol": "beyond-web-export/1",
	"id": "exp_…", "application": "site", "target": "web", "strategy": "self-contained", "base": "/",
	"entry": { "specifier": "@site/web/main", "vspecifier": "@site/web@1.0.0/main", "source": "catalog" },
	"files": [{ "path": "m/@site/web@1.0.0/modules/main.js", "kind": "module", "size": 1274, "digest": "sha256-…", "module": "@site/web@1.0.0/main" }],
	"sources": [{ "name": "@site/web", "version": "1.0.0", "provider": "workspace" }, { "name": "react", "version": "19.3.0", "provider": "store" }],
	"installation": { "state": "ready", "lock": "sha256-…" },
	"toolchain": { "packages": "0.0.1", "node": "22.21.1" },
	"diagnostics": [], "created": "…"
}
```

`digest` is the SHA-256 of each file as subresource integrity metadata; `sources` names the package each output came from and where the service read it (`workspace`, `supplied` by the toolchain, `store` of the installed graph, `installed` in the workspace's directories); `installation` is the state of the installed graph and the digest of its lock; `plan` is `installed` when the outputs were compiled from the installed graph, as `beyond build` compiles them, or `development` when the workspace has no installed graph and they came from what the development service supplies; `cdn` (`{origin, modules: [{specifier, url, integrity}]}`) is present for the `cdn` strategy. Outputs are reproducible under the same toolchain and inputs: two exports of unchanged sources list the same digests.

A catalog that cannot resolve targets (a development extension that predates `beyond-applications/1`) is `APPLICATIONS_UNAVAILABLE`, unless the request names the entry's public specifier (`entry`), which exists for validations of such a Core: the export then says so in its manifest (`entry.source: request`, `EXPORT_ENTRY_FROM_REQUEST`). The command line never sends one.

**An export without an installed graph is for trying the page only.** Its answer (`result.export` of the operation) says `plan: 'development'`, `developmentOnly: true` and a `reason`: it is not what `beyond build` produces, which requires an installed graph, and a CI machine cannot reproduce it. An export from an installed graph says `plan: 'installed'`. Both share the walk, the production outputs and the writing; what differs is where the packages come from.

**Progress.** The `write` step counts the files it writes, the manifest last, so a successful export ends with its count at its total (`N of N files`); `outputs` counts the modules it walked against those it knows of, and ends at its total too.

## The headless build

`beyond build <application>/<target>` runs the same export from a project root without a browser, a pairing or a person's running service: it starts an exclusive service (`Service.acquire({exclusive: true})`), requires an installed graph whose installation is `ready`, follows the operation and exits non-zero with the service's code and diagnostics. The command line's guide describes it and the toolchain bundle a CI runner installs it from.

## Bounds

| Variable | Default | Bounds |
| --- | --- | --- |
| `BEYOND_DECLARATION_TIMEOUT` | 60000 | The preflight's wait for the generated declaration of one public module (`types.state: unknown`, `DECLARATION_TIMEOUT`, past it) |
| `BEYOND_REGISTRY_TIMEOUT` | 15000 | One read of a registry's package document, body included |
| `BEYOND_PUBLISH_TIMEOUT` | 120000 | npm's publication, before its process group is ended |

An operation holds the service while it runs, within 15 minutes.

## Limits

- The export's loader is the browser's native import maps (ES modules). System.register output with a SystemJS loader is not produced, so a browser without import maps is not supported.
- A first-party package of the `source` form installed from a registry (a store node of an installed graph, such as the development runtime `@beyond-js/local-2026`) is compiled by the bundler it declares ([local installation](local-installation.md#the-development-service-in-install-mode)), so a page composed on the development runtime is exported from the installed graph. No public registry publishes those packages yet; a CI runner provisions them from the archives of the toolchain bundle.
- The archive does not add what npm adds by itself (the `main` and `bin` files of a manifest with `files`): the preflight says so. CommonJS or other formats are not produced.
- A registry that asks for a one-time password is refused (`EOTP`): npm runs without input.
- npm is run as `npm` on POSIX systems; Windows was not exercised.
- The `cdn` strategy is refused for an installed workspace, and its references are only as available as the CDN keeps the outputs: the export pins their digests and does not retain them.

## Validation

```sh
node --test "service/test/production*.test.mjs"      # the feature against stand-ins, npm against a registry of the test
node --test tests/production/packages.test.mjs       # preflight, archive, status and publication from the real service
node --test tests/production/export.test.mjs         # the web export from the real service, served and loaded in Chromium
```

[tests/production](../tests/production/README.md) names their prerequisites and what each file establishes. The command line's `production` acceptance group runs `beyond pack`, `beyond publish` and `beyond build` from an installation, and the headless build of a clean checkout with a toolchain bundle.
