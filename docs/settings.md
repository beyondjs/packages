# Local Dev Server settings

A person changes a bounded list of the development service's settings from the Packages interface, without restarting it where the setting allows it and without editing a versioned file. This is the `beyond-dev-settings/1` contract, implemented by the settings feature of the host ([service/host/settings/](../service/host/settings/index.mjs)) and claimed in `GET /session` as the `settings` capability. The engineering design of the contract, and of the interface that uses it, is the Beyond Suite's `docs/products/packages/developer-journey.md`.

These are local development settings, not machine administration: no port, bind address, pairing, origin, credential or CDN embedding can be changed here, and nothing here changes another product's configuration.

## The settings

| Key | Value | Default | Applies | Set by the environment with |
| --- | --- | --- | --- | --- |
| `cdn.origin` | The CDN origin that previews address modules on under `externals: cdn` and for packages not in development: `https://…`, or `http://…` on a loopback name (`localhost`, `*.localhost`, `127.x.x.x`, `[::1]`), with no path, query, fragment or credentials; or null | null | `live`: the next description of a preview | `BEYOND_CDN_ORIGIN` |
| `previews.timeout` | Milliseconds each CDN check of a preview waits, 500–30000 | 5000 | `live`: the next description of a preview | `BEYOND_PREVIEW_CDN_TIMEOUT` |
| `launch.deno` | The absolute path of a Deno 2 executable, or null | null | `launch`: the next launch of a Deno target ([launching execution targets](launches.md)) | `BEYOND_DENO` |
| `targets.<application>.<target>.environment` | The variables given to a launched backend target: at most 50 names matching `[A-Z_][A-Z0-9_]*` that are not reserved (below), string values of at most 4096 characters | `{}` | `launch`: the next launch of that target | None |
| `workspace.timeout` | Milliseconds the workspace is given to be read, at the start and at every reload, 10000–600000 | 120000 | `restart`: when the service starts again | `BEYOND_WORKSPACE_TIMEOUT` |

`<application>` and `<target>` are the identifiers of the applications catalog (`^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$` and `^[a-z][a-z0-9-]{0,31}$`). A target's variables are kept whether or not the target is declared now, and listed when stored.

**Fixed by the environment.** A setting whose variable is set, and not empty, in the environment the service started with is fixed: the document gives its value from the environment with `source: environment` and `editable: false`, a change of it is refused, and only a new start with another environment changes it. An empty variable is no value, as the readers of these variables take it.

**Not used by this service.** On a service started without the `launch` setting (every service but the one `beyond run` starts), which launches nothing, `launch.deno` is listed with `editable: false` and `reason: {code: 'LAUNCH_UNAVAILABLE', message}`, and a change of it is refused (`403 SETTING_UNAVAILABLE`) before anything is checked: no executable is ever run there.

**Reserved variables.** A target's variables never carry a name that configures the loader, the runtime or the toolchain: `LD_*`, `DYLD_*`, `NODE_OPTIONS`, `NODE_PATH`, `BEE_*`, `BEYOND_*` and `DENO_*`. A change that names one is refused (`422 SETTING_INVALID`); one the settings file holds, written by hand, is kept as written and not given at the launch, whose record says so (`LAUNCH_VARIABLE_IGNORED`).

**A workspace bound above the client's.** `workspace.timeout` bounds the service's own reads; a client that waits for a description (`BEYOND_REQUEST_TIMEOUT`, 300 s by default, [the service guide](service.md#embedding-the-service)) stops waiting earlier when the workspace bound is raised above it.

## Where they are kept

`<root>/.beyond/settings.json`, written by the service whole through a temporary file and a rename, readable by its user only (mode `0600`). The `.beyond` directory is the state of the service: it ignores itself for Git (`.beyond/.gitignore` holds `*`), and no file route lists, watches or changes it. The file holds only what differs from the defaults:

```json
{
	"protocol": "beyond-dev-settings/1",
	"values": {
		"cdn.origin": "https://cdn.example.com",
		"targets.composition.api.environment": { "PORT": "4000" }
	}
}
```

Its revision is `sha256-<hex>` of its bytes, and the revision of an absent file is the one of no bytes. The file is read whenever the document is read or changed, so a change by hand applies then, and is announced like any other. A key this service does not know (one a newer service wrote) and a value it refuses are reported in `diagnostics`, not used, and kept when the service writes the file; a file that is not a JSON document with a `values` object is reported and read as no values until a change replaces it.

**Only a file the service could have written is read.** The settings choose the executable a launch runs and the variables it receives, so a file the service did not write is never applied: one that is not a regular file (a symbolic link, a FIFO, which is opened without waiting for a writer), that another user owns, or that its group or other users may read or write (`mode & 0o077`, as a repository that commits one checks it out) is read as absent, its bytes unread: the revision of no bytes, the defaults, and the diagnostic `SETTINGS_FILE_UNTRUSTED`, which says how to correct it. A starting host does not read it either (`workspace.timeout`). The first change, based on that revision, writes the service's own file in its place. Ownership and modes are POSIX; on Windows the file is read as it is.

## Routes

| Route | Answer |
| --- | --- |
| `GET /settings` | `200` the document, `ETag: "<revision>"` |
| `PUT /settings {values: {"<key>": <value>, …}}` with `If-Match: "<revision>"` | `200 {outcome: 'completed', revision, document}`; `409 {outcome: 'conflict', revision, document}` |

```json
{
	"protocol": "beyond-dev-settings/1",
	"revision": "sha256-…",
	"settings": [
		{ "key": "cdn.origin", "value": "https://cdn.example.com", "default": null, "source": "file", "applies": "live", "editable": true, "variable": "BEYOND_CDN_ORIGIN" },
		{ "key": "previews.timeout", "value": 4000, "default": 5000, "source": "environment", "applies": "live", "editable": false, "variable": "BEYOND_PREVIEW_CDN_TIMEOUT" }
	]
}
```

The settings are listed in the order of the table, the stored target variables after `launch.deno` sorted by key. `source` is `default`, `file` or `environment`; `variable` names the environment variable of a setting that has one; `reason` says why a setting this service does not use is not editable; `diagnostics`, present only when the file has a problem, holds `{key?, code, message}` with `SETTINGS_FILE_INVALID`, `SETTINGS_FILE_UNTRUSTED`, `SETTING_UNKNOWN` or `SETTING_INVALID`.

A change states the revision it was based on and names the values it changes; null sets a key back to its default (an empty object for a target's variables). It changes every value it names or none, in this order:

| Refusal | Status | When |
| --- | --- | --- |
| `PRECONDITION_REQUIRED` | 428 | No `If-Match`, or `If-Match: *`, which names no revision a client read |
| `CONTENT_TYPE_UNSUPPORTED`, `BODY_TOO_LARGE`, `BODY_INVALID` | 415, 413, 400 | Not sent as `Content-Type: application/json`, larger than 1 MiB, or without a `values` object (at most 200 keys) |
| `SETTING_FIXED` | 403 | A key the environment fixes; `keys` names them |
| `SETTING_UNAVAILABLE` | 403 | A key this service does not use (`launch.deno` where nothing is launched); `keys` names them |
| `SETTING_INVALID` | 422 | One diagnostic per refused key, `{key, code: 'SETTING_INVALID' \| 'SETTING_UNKNOWN', message}`; the Deno executable is checked only once every value is otherwise valid |
| Conflict | 409 | The file is at another revision: nothing is written, and the answer carries the current document |

A change to the values the file already holds writes nothing: its revision stays and nothing is announced. Reads and writes of the file are done one at a time. Every answer is `no-store`.

**A lost answer.** A change whose answer did not arrive has an unknown outcome. The client reads the document again before it sends the change again: if the change was written, the values are there and the revision moved on, and sending it again with the old revision is a conflict, never a second write.

**Who reaches them.** On a service that pairs, a paired page and a local tool with the service's local credential; a local consumer is refused with `CREDENTIAL_REQUIRED` and a page of another site with `PAIRING_REQUIRED` ([portable connections](portable.md)). On a loopback service that does not pair, a page of another origin cannot send a change (`ORIGIN_REFUSED`). A service that verifies delegated grants (`BEYOND_AUTHORITY`, a Workspace project environment) is configured by the administration that grants them: it mounts no settings route and claims no `settings` capability.

## How each one applies

- **Live.** The feature writes `cdn.origin` and `previews.timeout` into the environment of the host as `BEYOND_CDN_ORIGIN` and `BEYOND_PREVIEW_CDN_TIMEOUT` (a value set back to its default as an empty variable), and the development extension reads those variables at each use: the preview's addresses when a description is built, and its CDN checks once per description ([the development contract](development-contract.md#preview-entry)). The next description reads the new value; one being built while the value changes may hold addresses of both origins. Processes the service starts afterwards inherit the same values.
- **At the next launch.** The launches feature reads `launch.deno` and a target's variables when it starts a process, through the settings feature it finds in the host's service registry (`services.get('settings').value(key)`), which answers the environment's value for a fixed setting, else the stored one, else the default. It checks the Deno executable again at every launch, whichever source names it, as a change of `launch.deno` is checked below (`DENO_INVALID` otherwise), and leaves the reserved variables out.
- **When the service starts again.** A starting host reads `BEYOND_WORKSPACE_TIMEOUT` from its environment completed with the stored `workspace.timeout` ([Startup](../service/host/settings/startup.mjs)), unless the environment sets the variable itself; the running service keeps the bound it started with, and the document says `applies: restart`.

**Every change is announced** as `settings.changed {revision}` on the event stream of the development extension (`GET /events`), the change by hand that a read observes included, so every client reads the document again instead of polling.

## The Deno executable

`launch.deno` must be an absolute path to an existing file the user of the service can execute, and that file must answer `--version` with Deno's first line for a 2.x release (`deno 2.1.4 (stable, release, …)`) within 5 seconds (`Deno.TIMEOUT`). It runs in a process group of its own with only `PATH`, `HOME` and `NO_COLOR` in its environment, never the service's, which holds its credentials. An executable that does not answer within the bound, or that leaves a process holding its output open, is refused, and its process group is ended. The same check runs before every launch of a Deno target, so a file replaced since it was set, or one a settings file names, is refused then.

## Validation

`node --test "service/test/*.test.mjs"` runs the feature against stand-ins: `settings.test.mjs` (the document, fixed values, preconditions and conflicts, validation, writes, events, live application, changes by hand, delegated access), `settings.trust.test.mjs` (a file readable by others, a symbolic link and a FIFO read as absent and replaced by the first change, a file of another user, reserved variables refused in a change and kept from a file, `launch.deno` unavailable and never run on a service that launches nothing), `settings.deno.test.mjs` (the Deno check with stand-in executables, its bound and the end of what a hung executable started) and `settings.startup.test.mjs` (the bound a starting host reads). [tests/types](../tests/types/README.md) runs `settings.test.mjs` against the real service started from this checkout, with the `launch` setting: a change of `cdn.origin` and of `previews.timeout` reaches the next preview description without a restart, a fixed value is refused, a Deno stand-in is checked, the change is announced on the event stream, a file readable by others is not read and is replaced by the next change, and only the service's own clients reach the routes.
