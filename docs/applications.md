# Applications and execution targets

A workspace declares which of its public modules are the entries of its applications: an **application** groups the **execution targets** that are developed and published together, and each target names the public module a browser document loads (a `frontend` target) or a server process runs (a `backend` target). The development extension (`@beyond-js/packages/development`, [modules/development/applications](../modules/development/applications/index.ts)) reads that declaration, lists it as a catalog, resolves each target against what the workspace serves, writes one application at a time through the File API and announces every change on the event stream. This is the `beyond-applications/1` contract, claimed in `GET /session` as the `applications` capability; its machine-readable form is [contracts/applications](../contracts/applications/README.md). The engineering design of the contract, and of the Packages interface and command line that use it, is the Beyond Suite's `docs/products/packages/developer-journey.md`.

A library or a widget is never a target unless an application declares it, and declaring a target compiles nothing by itself: the outputs it resolves to are the ones the routes of the service build on request.

## The declaration

Applications are declared in the `applications` branch of the workspace root's `beyond.json`, keyed by identifier, inline or in a JSON file of the workspace that the branch names relative to `beyond.json`:

```json
{
	"packages": ["shared", "web", "api"],
	"applications": {
		"composition": {
			"title": "Composition",
			"targets": {
				"web": { "title": "Web page", "kind": "frontend", "package": "@testbed/composition-web", "entry": "./main" },
				"api": {
					"title": "Backend API",
					"kind": "backend",
					"package": "@testbed/composition-api",
					"entry": "./server",
					"runtime": "node",
					"readiness": { "output": "composition API listening" }
				}
			}
		}
	}
}
```

`"applications": "config/applications.json"` keeps the same object in its own file. An application is identified by its key, with CDN's application name pattern `^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$`, and a target by its key inside the application, with CDN's target name pattern `^[a-z][a-z0-9-]{0,31}$`. Identity never comes from a directory, so the branch is an object: a list is refused rather than read in part.

| Field | Of | Meaning |
| --- | --- | --- |
| `title` | application, target | What a person calls it, 1 to 80 characters, stored as written |
| `targets` | application | Its execution targets, keyed by identifier; an application may have none yet |
| `kind` | target | `frontend` or `backend` |
| `package` | target | The package that publishes the entry, optionally prefixed by its provider as CDN accepts it (`npm:name`) |
| `entry` | target | The public subpath of the entry: `.` or `./<name>` |
| `conditions` | target | Optional compilation conditions of its publication: names, sorted and unique |
| `selection` | target | Optional version selection of its publication; development uses the workspace's own package, and the selection only names one of several local versions of it |
| `runtime` | backend target | `node` or `deno`, optionally with a requirement (`node>=22`), at most 80 characters; `node` when absent |
| `readiness` | backend target | Optional `{ "output": "<text>" }`: the process is ready once its output contains that text |

The catalog adds the public **specifier** of the entry (`<package>/<name>`, or the package for `.`) and the **environment** its consumer runs in: `browser` for a frontend target, `node` or `deno` from the runtime of a backend one. Fields the Core does not know are kept in the document as written and reported as warnings.

| Code | Severity | Meaning |
| --- | --- | --- |
| `APPLICATIONS_INVALID` | error | `applications` is neither an object nor a file name, names no file or a directory, or a path that is no path of the workspace |
| `APPLICATIONS_ARRAY_UNSUPPORTED` | error | The branch, or the file it names, is a list |
| `APPLICATIONS_FILE_MISSING` | error | The file the branch names does not exist; the first creation writes it |
| `APPLICATIONS_FILE_INVALID` | error | The owning document is not JSON, not an object, or larger than 1 MiB; or the branch names another document of the workspace or of the service: a manifest (`package.json`, `module.json`, `beyond.json`, `beyond.json` itself included), the lock (`beyond-lock.json`) or anything under `.beyond` |
| `APPLICATIONS_FILE_OUTSIDE` | error | The branch names a file outside the workspace: by its path, absolute, through a symbolic link, or in `.git` |
| `APPLICATION_ID_INVALID`, `APPLICATION_TITLE_INVALID`, `APPLICATION_INVALID` | error | An application's key, its title, or its value (not an object, or targets that are not an object) |
| `TARGET_ID_INVALID`, `TARGET_TITLE_INVALID`, `TARGET_INVALID` | error | A target's key, its title, or its value (not an object) |
| `TARGET_KIND_INVALID`, `TARGET_PACKAGE_REQUIRED`, `TARGET_ENTRY_INVALID`, `TARGET_CONDITIONS_INVALID`, `TARGET_SELECTION_INVALID`, `TARGET_READINESS_INVALID` | error | A field of a target |
| `TARGET_RUNTIME_FRONTEND` | error | A runtime declared on a frontend target |
| `TARGET_RUNTIME_INVALID` | error | A runtime that is not text of 1 to 80 characters |
| `TARGET_RUNTIME_UNSUPPORTED` | warning | A runtime the Core does not launch (neither Node nor Deno); the declaration stays valid |
| `APPLICATION_FIELD_UNKNOWN`, `TARGET_FIELD_UNKNOWN` | warning | A field this Core does not know, kept as written |

A declaration with errors keeps every application and target: an invalid one is listed with its diagnostics, never dropped. Each diagnostic is `{code, message, severity, field?}`.

**A file the branch names** is read only when it is a file of the workspace: the reference is resolved relative to `beyond.json` and must stay inside the root, without `..` above it, an absolute path or a backslash, and the File API refuses one that reaches outside through a symbolic link or names repository internals. Nor is it another document of the workspace or of the service: a manifest, the lock or the state of the service (`.beyond`) is refused by its name before anything is read, since its fields would otherwise be listed, replaced and removed as applications (`DELETE /applications/name` would remove the `name` of a `package.json`). Nothing is read from such a file, and nothing of it is disclosed. Neither the configuration mechanism nor the File API is a containment boundary of its own here; the catalog checks the reference before either reads it.

## The catalog

`GET /applications` (`inspect.read`) answers the catalog, read from the documents as they are now:

```json
{
	"protocol": "beyond-applications/1",
	"generation": 4,
	"document": { "path": "beyond.json", "branch": "inline", "exists": true, "revision": "sha256-…" },
	"following": { "live": true, "watchers": "ready", "events": true },
	"applications": [
		{
			"id": "composition",
			"title": "Composition",
			"targets": [
				{
					"id": "web",
					"title": "Web page",
					"kind": "frontend",
					"package": "@testbed/composition-web",
					"entry": "./main",
					"specifier": "@testbed/composition-web/main",
					"environment": "browser",
					"diagnostics": []
				}
			],
			"diagnostics": []
		}
	],
	"diagnostics": []
}
```

- **The owning document** is `beyond.json` for an inline branch (or none yet) and the named file for a file-backed one (`branch: file`, `path` that file, `reference` as `beyond.json` writes it). `revision` is the File API's revision of it, which a write states with `If-Match`; a document that does not exist has none (`exists: false`), and the first creation writes it.
- **The generation** grows by one every time the catalog changed: what it lists, its diagnostics or the revision of its document. A catalog that did not change keeps its generation, so equal generations are equal catalogs.
- **Following** says how the service follows the declaration now, which is state of the service and no part of the generation: `watchers` is `ready` when the watchers service follows the documents, `starting` until its watcher is ready, and `unavailable` with the `reason` when it failed or was not ready within its bound; `events` whether the File API's events of the documents are followed (unless `BEYOND_APPLICATIONS_FOLLOW=watchers`, and until the File API's own watcher fails); `live` whether either one does, so that a change reaches the catalog and `applications.changed` without a request. When it is not live, a client sees a change by reading the catalog again.
- Applications and targets are listed in the order the document declares them.

## Resolving a target

`GET /applications/:application/targets/:target` (`inspect.read`) answers what the Core establishes for one target, `404 APPLICATION_NOT_FOUND` or `TARGET_NOT_FOUND` otherwise. The host's features reach the same answer with `services.get('applications').resolve(application, target)`, which is what a launch starts from.

| Field | Meaning |
| --- | --- |
| `declared` | The target as the catalog lists it |
| `entry` | `specifier` and, once the public module is found among the ones the workspace serves, `vspecifier` and `package: {name, version, source, selected}`: `source` is `workspace` for a member and `toolchain` for a package the toolchain supplies, `selected` whether the development selection puts it in development |
| `environment` | `browser`, `node` or `deno` |
| `build` | Whether the entry builds for the platform of its environment (`web` for a browser, `node` otherwise): `built` with its `hash`, `failed`, `unsupported` when its module does not declare that platform, or `pending` when it is still being built once the bound of the resolution passed (below) |
| `composition` | The public modules the entry reaches on that platform and their packages, counted by source (`workspace`, `environment`, `cdn`, `unresolved`, and `mixed` for a package whose modules differ), from the composition document of the entry (`GET /preview/composition.json`) |
| `open` | A frontend target's preview document, `/preview/?entry=<specifier>`: a path the client joins with the preview origin of the session (`service.preview`) |
| `launch` | A backend target: `{supported: true, specifier}` for Node, `{supported: true, requires: 'deno', specifier}` for Deno, `{supported: false, reason}` with the first error or `TARGET_RUNTIME_UNSUPPORTED`. `specifier` is what a launch imports: the entry's public specifier, or its versioned one (`entry.vspecifier`) when several local versions publish it, as the session, the preview and `open.preview` name it, so the version the target's `selection` names is the one that runs (the launches feature and `beyond run --target` import it). Whether this service may launch at all is its `launch` capability ([launching execution targets](launches.md)) |
| `diagnostics` | What resolution found: `TARGET_PACKAGE_NOT_FOUND`, `TARGET_ENTRY_NOT_FOUND`, `TARGET_AMBIGUOUS` (several local versions publish the entry and the target's `selection` names none of them by its exact version), `TARGET_ENVIRONMENT_UNSUPPORTED`, and the warnings `TARGET_BUILD_FAILED` with the build's messages and `TARGET_BUILD_PENDING` |

Resolution reads: it builds the entry as `GET /m/…` would and the composition as its route would, never anything else, and never starts a process. It waits for those builds within `BEYOND_TARGET_BUILD_TIMEOUT` (30000 ms by default, under the launches' wait for a resolution and a client's `BEYOND_REQUEST_TIMEOUT`): an entry still being built then is `build: {state: 'pending'}` with the warning `TARGET_BUILD_PENDING`, its composition is not read (it would build the graph), the build goes on, and the next resolution finds it done; a composition not described within the bound says so in its `reason`. Opening the preview of a frontend target says nothing about whether the page rendered.

## Writing one application

`PUT /applications/:application` creates or replaces one application with its value as the JSON body (`Content-Type: application/json`, at most 256 KiB); `DELETE /applications/:application` removes one. Both need `files.write`, because they write the owning document through the File API's mutation, with the document's revision as the expected one: a write here and a write of the same file through `PUT /files/content/*`, an editor or Git conflict properly, and the File API announces the write (`file.changed`, origin `api`, with the actor of a delegated grant).

| Request | Answer |
| --- | --- |
| `PUT` with `If-None-Match: *` | Creates the application, and the document when it does not exist: `200 {outcome: completed, revision, catalog}`; `409 {outcome: conflict, revision, catalog}` when the application exists |
| `PUT` with `If-Match: "<revision>"` | Creates or replaces the application: `200`, or `409` with the current revision (`null` when the document does not exist) when the document changed |
| `DELETE` with `If-Match: "<revision>"` | `200`; `409` as above; `404 APPLICATION_NOT_FOUND` |
| Without a precondition | `428 PRECONDITION_REQUIRED` |
| A body that is not JSON | `415 CONTENT_TYPE_UNSUPPORTED` for another media type, `400 BODY_INVALID`, `413 BODY_TOO_LARGE` |
| An invalid application | `422 APPLICATION_INVALID` with `diagnostics`, each with the `target` it is about; nothing is written |
| A document that is not rewritten | `422` with its code: `APPLICATIONS_FILE_INVALID`, `APPLICATIONS_ARRAY_UNSUPPORTED`, `APPLICATIONS_FILE_OUTSIDE`, `APPLICATIONS_INVALID` |

`catalog` is the catalog after the write. Writes keep the organization of the branch (inline stays inline, a file stays a file) and change only the characters of what changed: the other members of the document, its key order, its indentation (tabs or spaces as found), its newlines and its final newline are kept, and a replaced application is edited member by member, so a target written on one line that did not change keeps its line. Members a replacement adds go after the existing ones. A replacement states the application's known fields; fields this Core does not know are kept from the declaration unless the replacement names them, in the application and in each target it keeps. A new document is written with tabs and a final newline. Writes run one at a time.

## Events

After the catalog processed a change, whoever wrote the documents (the interface, an editor, an agent, Git), the event stream announces `applications.changed {generation, revision}`, with the revision of the owning document (`null` when it does not exist). The File API's own `file.*` event of the change precedes it. A client reads `GET /applications` again on it, and after a `resync`.

- **Following.** The documents are followed with the public `Config` of `@beyond-js/config/main`, watched through the host's watchers service (a watcher of the root and one listener per document), and through the File API's own events of the same documents; both ask for the same processing, and the catalog's `following` says which of them follow it now. `BEYOND_APPLICATIONS_FOLLOW=watchers` follows them through the watchers service alone, which is how [the validation](../tests/applications/README.md) shows that path on its own. The watcher of the root is started in the background, and a start does not wait for it: until it is ready the File API's events follow the documents. A watcher that fails, or is not ready within `BEYOND_APPLICATIONS_WATCH_TIMEOUT` (30000 ms), leaves `watchers: unavailable` with its reason, said once in the log of the process; one that is ready later follows them from then on. A process without a watchers service, such as one that embeds the development extension for a test, reads the declaration all the same.
- **Processing.** One processing runs at a time, and a request shares the processing that starts after the one in progress, which may have read the files before the change: rapid edits converge on the newest, and an obsolete processing never replaces a newer one. Each processing reads the documents through the File API, so the catalog and the revision it names come from the same bytes.
- **Transient files.** A malformed or missing document gives a catalog with its diagnostics and no applications; the next valid version converges.

Declaring or editing an application never reloads the hosted workspace: the host compares a `beyond.json` by its content without its `applications` ([service/host/manifests.mjs](../service/host/manifests.mjs)), so its modules are not compiled again, whether the branch is inline or in its own file. The host announces `workspace.changed {reloads}` when a change of a `package.json`, `module.json`, `beyond.json` or `beyond-lock.json` reloaded the hosted workspace ([service/host/reloads.mjs](../service/host/reloads.mjs)): it refreshes the workspace as a request that describes it does, within `BEYOND_WORKSPACE_TIMEOUT`, and announces the count of reloads once a reload served the new declarations, so a client reads the session and the state again instead of polling. A `resync` of the log (the File API's watcher failed, so a change may have gone unannounced) refreshes it the same way.

## Access

On a service that pairs browsers, a paired page and a local tool with the service's local credential read and write the catalog; a local consumer (a process without the credential), a page of another site and the preview listener reach none of its routes. In delegated mode the grant needs `inspect.read` to read and `files.write` to write.

## Compatibility

- A workspace without `applications` keeps working, with an empty catalog; nothing is converted, and no application is invented.
- A `beyond.json` declares members only through a non-empty `packages`. One without it (absent, `null` or `[]`) holds the applications and never decides the kind of the workspace: its manifest does, `npm` when it declares `workspaces` or `beyond.workspaces` and `standalone` otherwise ([declaring a workspace](local-installation.md#declaring-a-workspace)). Beside declared workspaces it is no conflict, `"packages": []` included; a non-empty `packages` there is `WORKSPACE_CONFIG_CONFLICT`, as before. A `beyond.json` beside them that cannot be read keeps the members the manifest declares, with the warning `WORKSPACE_CONFIG_INVALID`.
- Declaring the first application of a standalone package (creating its `beyond.json`) changes neither its kind nor its declaration digest, so its installed graph stays ready.
- A service without the development extension, or a Core older than the catalog, claims no `applications` capability: a client tells it apart from the session.

## Limits

- The `Config` and `@beyond-js/file` installed with Packages (1.0.3 and 1.0.6) do not pass a change confined to a declared branch on to it, do not watch a file a declared branch names, and do not parse a corrected file after a malformed one. Each document is therefore a `Config` of its own, without declared branches, with its own listener, and the watcher's event of a document counts as a change of it.
- The watcher of the root watches the whole root, beside the watchers of the members.
- `applications.changed` reaches every subscriber of the event stream, the preview listener's included; it carries a generation and a revision, nothing of the declaration.
- An application identifier made of digits only is listed before the others, in the order JSON objects keep such keys. Of a key written twice, the last one is read, and removing an application removes every one.
- The CDN mapping notes `TARGET_TITLE_LOCAL` and `TARGET_READINESS_LOCAL` belong to the mapping of a target to CDN and are not part of the catalog.
- A package root whose `beyond.json` declares no `packages` and whose manifest declares no workspaces was read as a `beyond-json` root before the rule above, and is `standalone` now: its declaration digest changes once, which makes a graph installed before it stale once, until the next `beyond install`.

## Validation

```sh
node --test contracts/applications/test/fixtures.test.mjs
node --test "service/test/*.test.mjs"
node --test tests/applications/catalog.test.mjs
node --test tests/applications/events.test.mjs
node --test tests/applications/npm.test.mjs
node --test tests/applications/standalone.test.mjs
```

The contract test checks the schema against its fixtures and the testbed's declarations when the suite is around Packages; `service/test` covers the workspace declaration beside npm workspaces and in a standalone package (`declaration.applications.test.mjs`) and `workspace.changed` with stand-ins (`reloads.test.mjs`); [tests/applications](../tests/applications/README.md) runs the real service from this checkout; the `applications` group of [tests/development](../tests/development/README.md) runs the bounded resolution and the launch specifier of two local versions over a stand-in delivery.
