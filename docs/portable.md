# Portable connections: pairing, access, exports and the fallback interface

How a development service is used by the Packages interface from a browser, and how its source is frozen for a capture. It is the service side of `beyond-dev-pairing/1` and `beyond-dev-exports/1`; the command line starts services this way (`beyond run`). The service's general behavior is in [the service guide](service.md), and the File API, events and builds in [the development contract](development-contract.md).

| Part | Where |
| --- | --- |
| The corrections every service receives | [Host](../service/host/hosts.mjs), [compiled-module routes](../modules/http/routes/modules/index.ts), [file paths](../modules/development/root.ts), [request bodies](../modules/development/http/routes.ts) |
| Two listeners, callers, cross-origin rules and pairing | [Portable](../service/host/portable.mjs), [pairing/](../service/host/pairing/index.mjs) |
| Durable exports and their transfer | [exports/](../service/host/exports/exports.mjs) |
| The fallback interface | [Interface](../service/host/interface.mjs) |
| What `/session` says the service implements | [Capabilities](../service/host/capabilities.mjs) |
| The client side: the local credential and pairing management | [Credential](../service/credential.mjs), [PairingClient](../service/pairing.mjs), [Attachment](../service/attachment.mjs) |
| Documents of both protocols | [contracts/portable](../contracts/portable/README.md) |

## Every service

A service that does not pair, as Conduict's runner and a Workspace environment start it, keeps its access with four corrections that every service receives:

- **`Host` is checked on every request of a loopback bind** (`403 HOST_REFUSED`): a loopback name (`127.0.0.1`, `localhost`, `[::1]`) with the port the request arrived on, or the public host of that port. A site whose name was made to resolve to this machine (DNS rebinding) names itself and is refused, preflights included. Behind another address something else decides who reaches the service.
- **Cross-origin headers only on the compiled-module routes.** The contract's `Access-Control-Allow-Origin: *` (and the answer to a preflight) is given to `/m/`, `/u/`, `/resolution.json` and `/importmap.json` only; the session, the state, the files and every other route are not readable by a page of another origin.
- **Request bodies are parsed only when sent as `Content-Type: application/json`** (`415 CONTENT_TYPE_UNSUPPORTED`): `POST /files/operations`, and a form or text type on `POST /builds` and `POST /builds/:id/cancel`, which take no body. A page of another site can send a text body to any origin without asking first, never a JSON document.
- **`.git` and `.beyond` are refused at any depth of a file path** (`403 PATH_FORBIDDEN`), compared without regard to case: a nested repository's `sub/.git/config` is not writable through the File API.

Conduict's development proxy rewrites `Host` to `127.0.0.1:<port>` and `Origin` to the service's own origin when the browser sent one, which these rules accept.

### A loopback service that does not pair

A service on the loopback address that neither pairs nor verifies delegated grants, as `beyond test` and `beyond install` start it, and Conduict's runner behind its proxy, has no authentication, so it also answers pages of other origins only what the compiled-module contract lets them read ([SameOrigin](../service/host/same-origin.mjs)):

- **A change from a page of another origin is refused** (`403 ORIGIN_REFUSED`): any method but `GET`, `HEAD` and `OPTIONS` sent with an `Origin` other than the one it addressed. A page sends its own on every such request, even one without a body, which needs no preflight (`POST /builds`, `POST /builds/:id/cancel`); a process sends none, and Conduict's proxy sends the service's own.
- **A page of another origin cannot attach** (`GET /attach`, `403 ORIGIN_REFUSED`), told by its `Origin` or, for a request that carries none (an image, a classic script), by a `Sec-Fetch-Site` other than `same-origin` or `none`: no page keeps the service alive.
- **The compiled-module routes answer `Access-Control-Allow-Origin: *` only to a request without an `Origin`, to the service's own origin and to the embed origins** of `BEYOND_EMBED_ORIGINS` (origins separated by commas; `*` gives it to every origin, as before); a page of any other origin reads none of them, preflights included, and their answers vary by `Origin`.

A service that verifies delegated grants (Workspace), or listens on another address, keeps the rules it had: grants or the network decide who reaches it.

## A service that pairs

The `pairing` setting (`Service.acquire({ pairing })`, which the command line passes) turns on everything below. It is refused together with delegated access (`BEYOND_AUTHORITY`), which also reads `Authorization: Bearer`, and on a non-loopback bind unless the service is given its public origin.

```js
const { connection } = await new Service(context).acquire({
	lifetime: 'owner',
	extensions: ['@beyond-js/packages/development'],
	pairing: { origins: ['https://packages.example'], embeds: ['https://site.example'], public: 'https://space-{port}.forward.example' },
	interface: '/path/to/ui/build'
});
```

| Setting | Meaning |
| --- | --- |
| `pairing.origins` | Interface origins allowed to pair, besides the API listener's own (the command line gives `BEYOND_PACKAGES_UI` and `--ui`) |
| `pairing.embeds` | Origins whose pages import the preview listener's compiled modules (the command line gives `BEYOND_EMBED_ORIGINS` and `--embed`); the service adds `BEYOND_EMBED_ORIGINS` of its own environment |
| `pairing.public` | The https origin an external server is reached through; `{port}` stands for the port of each listener (Codespaces forwards each port at its own address). A fixed origin names the API listener only |
| `interface` | A directory with the static build of the Packages interface, served at `/ui/`; without `index.html` the start fails |

### Two listeners

| Listener | `/session` | Serves |
| --- | --- | --- |
| API | `service.origin`, and `service.public` behind a forwarder | The session, state, files, events, builds, selection, installation, exports, pairing, the fallback interface, and the preview documents for paired and local callers |
| Preview | `service.preview` (its public origin behind a template) | `GET` and `HEAD` only, to its own pages, a navigation from anywhere and the allowed origins (below): the preview document and its entry and composition documents, compiled modules and updates for browsers (code, a map or an update that names another target is `403 TARGET_REFUSED`, and so is a resolution document without `target=browser`; stylesheets and declared assets are the same for every target and are served whatever target their address names, which lets a page load the stylesheets a server render listed), and build events without `file.*`, `batch.*` or `export.*`. Everything else is `404 NOT_FOUND` |

Code that runs in a preview, the application's and its dependencies', never shares an origin with the API or the interface, so it can read no token and reach no privileged route.

Cross-origin headers decide only what a page reads: a classic `<script>`, a stylesheet or an image loads without them. So the preview listener also serves a page by the Fetch Metadata its browser sends ([Sites](../service/host/pairing/sites.mjs)): a navigation from anywhere (what it opens runs on the preview origin, and another site cannot read it); a request of the preview origin (`same-origin`), one the person made (`none`) and one without Fetch Metadata; a request of the same site (`same-site`) while the listener is reached through a loopback name, since only a page this machine serves there is of that site (behind a public origin it counts as another site's: a forwarding domain serves other people's ports); and a request of another site only from an allowed origin of the preview listener, told by its `Origin` or, for one without (a classic script, a stylesheet, an image), by the origin of its `Referer`, which a page can withhold but not forge. Anything else is `403 SITE_REFUSED`: a page of another site cannot run the workspace's modules with a shim of its own (`format=system`), nor apply its stylesheets.

### Callers on the API listener

| Caller | Recognized by | Reaches |
| --- | --- | --- |
| Local tool (the command line) | `Authorization: Local <credential>` | Everything |
| Paired page | `Authorization: Bearer <token>` from the origin the token was paired from | Everything |
| Local consumer (BEE Node, a Node consumer) | No credential, no `Origin` and no `Sec-Fetch-Site`, a loopback remote address and a loopback `Host`, no header of a proxy or a tunnel (`Forwarded`, `Via`, `X-Forwarded-*`, `X-Real-IP`, `CF-Connecting-IP`, `CDN-Loop` and the others [Forwarding](../service/host/pairing/forwarding.mjs) names), and no public origin configured | Reads: `/`, `/session`, `/state`, `/selection`, `GET /installation`, compiled modules and updates, the resolution documents, build events (no source or export events), `/attach` and the preview documents |
| Anyone else | | `POST /pairing` from an allowed interface origin, its preflight, and `/ui/` |

The **local credential** is a random secret the supervisor writes at start into the service's directory (`credential`, mode 0600) and removes when the service ends; the discovery record names the file, and `Service` presents it on every request of the connection it returns (`connection.headers`) unless the caller gave its own `authorization`. Behind a public origin, or on a non-loopback bind, nobody is a local consumer.

**A forwarded port needs `--public-origin`.** A tunnel reaches the loopback address from its own process, often with a `Host` it rewrote to a loopback one (ngrok's `--host-header=rewrite`, cloudflared, the port forwarding of editors): the headers it adds make its requests visitors, never local consumers. A forwarder that adds none, as `ssh -R` and `socat` forward bytes rather than requests, cannot be told from a process of this machine, so a port forwarded to another machine is started with the address it is reached at (`--public-origin`), behind which every request needs the credential or a token.

| Refusal | When |
| --- | --- |
| `401 PAIRING_REQUIRED` | A browser without a token, or with an unknown one |
| `401 PAIRING_EXPIRED`, `401 PAIRING_REVOKED` | A token whose pairing ended |
| `403 PAIRING_ORIGIN` | A token presented from another origin than the one it was paired from, or `POST /pairing` from an origin that may not pair |
| `401 CREDENTIAL_REQUIRED` | A process without the credential that changes something, reads a source, or reads anything behind a public origin or through a proxy or a tunnel; a wrong credential; a route of local tools called by anyone else |
| `403 SITE_REFUSED` | On the preview listener, a request of a page of another site that is not an allowed origin and does not navigate |

The decision is left on the request under `Symbol.for('beyond.caller')`: the development extension reads it in local mode (`Access.require`), so a capability a caller lacks is refused with the caller's reason, a stream filters source and export events for callers without `files.read`, and an event stream (`/events`, `/attach`) opened with a token ends with `access.ended` and `PAIRING_EXPIRED` or `PAIRING_REVOKED` when its pairing ends.

### Cross-origin rules

Nothing of a pairing service is readable with `*`. For an allowed origin of the listener a request arrived on, a preflight is answered with that origin, `GET, PUT, POST, DELETE`, `authorization, content-type, if-match, if-none-match, last-event-id`, `Access-Control-Max-Age: 600`, `Access-Control-Allow-Private-Network: true` when it is asked for, and `Vary: Origin`; every answer then carries that origin, `Vary: Origin` and exposes `etag, beyond-cursor, location, sourcemap, link`. Any other origin gets no cross-origin header at all.

| Listener | Allowed origins |
| --- | --- |
| API | Its own origins (loopback names with its port, its public origin), the configured interface origins, the origins an outstanding code names and those of valid pairings. Never the preview's |
| Preview | Its own origins, the API's allowed origins and the embed origins |

### `beyond-dev-pairing/1`

| Route | Caller | Answer |
| --- | --- | --- |
| `POST /pairing/codes` (`{origins?}` or no body) | Local tool | `201 {code, expires, origins}`: 8 Crockford base-32 characters shown as `XXXX-XXXX`, valid once for 10 minutes; at most five outstanding, a sixth replacing the oldest; `origins` are where it can be redeemed. A given origin that is not one is `400 PAIRING_ORIGINS_INVALID`, the preview's included |
| `POST /pairing` `{code}` as JSON | A page of an allowed interface origin | `201 {token, expires, pairing: {id, origin, created}, session}`; `401 PAIRING_CODE_INVALID` for an unknown, used or expired code; a wrong attempt counts against every outstanding code, and the fifth one against a code ends it: that attempt and every one after it until a new code is `429 PAIRING_ATTEMPTS` |
| `DELETE /pairing` | The paired page | `204`: its pairing ends (`PAIRING_REVOKED`) |
| `GET /pairings`, `DELETE /pairings`, `DELETE /pairings/:id` | Local tool | `{pairings: [{id, origin, created, used, expires}]}`; `204`; `404 PAIRING_NOT_FOUND` |

A code is typed as the person reads it: case, spaces and the hyphen do not matter, and `I`, `L` and `O` are read as `1`, `1` and `0`. A token is 32 random bytes in base64url, kept only as its SHA-256 in memory, bound to one origin and valid for `BEYOND_PAIRING_TTL` milliseconds (12 hours by default); a stopped service forgets every pairing. Codes and tokens are never logged, written to disk or put in an address, and every answer of these routes is `no-store` and `no-referrer`. Every new pairing is announced on the attachment streams (`event: paired`, `{id, origin}`), which is how `beyond run` names it as it happens. The owner token of an attachment travels in the `Beyond-Owner` header, never in its address.

### Capabilities

`GET /session` lists `capabilities`, each with the major version the service implements, read from what it mounted: `state` and `installation` always; `files`, `events`, `builds`, `declarations`, `selection`, `preview` and `composition` when the routes of the development extension that answer them are mounted (`/files/tree`, `/events`, `POST /builds`, `/declarations/*`, `/development/selection`, `/preview`, `/preview/composition.json`); `pairing` and `exports` on a service that pairs, and `ui` when it serves the interface. A client decides compatibility from them before any tool is used; the versions of the packages being developed never decide it.

## `beyond-dev-exports/1`

| Route | Answer |
| --- | --- |
| `POST /exports {packages: [path]}` as JSON | `201 {export}`, `failed` when a package could not be archived; a path is `.` (a root that holds a `package.json` naming the package and its version) or the directory of a member declared inside the root, anything else `400 EXPORT_PACKAGE_INVALID` (`..`, absolute, undeclared, a member outside the root, reached through a link) |
| `GET /exports`, `GET /exports/:id` | `{exports}`, `{export}`; `404 EXPORT_NOT_FOUND` |
| `POST /exports/:id/transfer {capture: {id}, grants: [{path, upload, token, expires}]}` as JSON | `202 {export}`; `400 EXPORT_TRANSFER_INVALID` unless every package not stored for that capture has exactly one grant; `403 EXPORT_DESTINATION` unless each `upload` is exactly `<origin>/v1/captures/<capture id>/archive?package=<path>` for an origin of `BEYOND_SNAPSHOTS_ORIGINS`; `409 EXPORT_CONFLICT` while a transfer of the export runs, or for a failed export |
| `DELETE /exports/:id` | `204`: a transfer under way is cancelled and the archives are removed |

An export is `{id, protocol, state, created, expires, packages: [{path, name, version, manifest, digest, bytes, files, excluded, omitted?}], capture?, transfer?: {packages: [{path, state, error?}]}, error?}`: `digest` is the SHA-256 of the archive in hexadecimal, as Snapshots declares it, `files` the paths the archive holds, `excluded` what it left out by reason (`ignored`, `secrets`, `links`, `members`, `internal`), a directory left out whole named once with its slash, never content; past 1 000 paths of one reason, `omitted` counts the rest.

**Which files.** A package's archive holds what its registry publication would hold: the files its manifest's `files` names (each pattern anchored at the package root, a directory naming everything inside, `!` taking files back out), with `package.json`, `README*` and `LICENSE*`/`LICENCE*` always; without `files`, every file its `.npmignore` (or `.gitignore` when a directory has none) does not ignore, with Git's semantics, each directory's file applying below it. Never: what npm never publishes (the ignore files themselves, version-control directories, `npm-debug.log`, editor swap files, `.DS_Store`, `*.orig`, the root's npm, Yarn and pnpm lockfiles), `node_modules`, `.beyond` and `.git` at any depth, the directories of other workspace packages, symbolic links and secrets (`.env` and `.env.*` but `.env.example`, keys and certificates, `.npmrc`, `.yarnrc*`, `.pypirc`, `.netrc`, Terraform state, local databases, and the directories `.ssh`, `.aws`, `.azure`, `.gnupg`, `.idea` and `.vscode`; the complete list is in [Rules](../service/host/exports/rules.mjs)). npm's other additions, the `main` and `bin` files of a manifest with `files` and the `.npmignore` files inside the directories `files` names, are not reproduced. The root package `.` therefore holds its own files and never another package of the workspace.

**Archive.** Ustar with a pax record for a path longer than 100 bytes; entries walked depth first and sorted by name; a directory written only when it holds a file of the archive; modification times, owners and groups 0; files `0644` or `0755`, directories `0755`; two zero blocks at the end. Equal sources give equal bytes. A file is opened without following a link and must be the entry the walk listed (device and inode), and a directory must stay the one that was listed, or the export fails with `EXPORT_CHANGED`. Bounds: 50 MiB of archive and 10 000 files per package, 200 000 entries walked (`EXPORT_TOO_LARGE`, recorded in a failed export whose archives are not kept).

**Durability.** Records and archives live in `<root>/.beyond/exports/<id>/` (`export.json`, `<index>.tar`), which no file route lists or changes; `.beyond/.gitignore` is written when it is missing. An export expires after `BEYOND_EXPORT_RETENTION` milliseconds (24 hours) and is swept at start and every hour. A transfer that a stop of the service interrupted leaves its packages `unknown` (`EXPORT_INTERRUPTED`).

**Transfer.** Each archive is read and hashed again first; bytes that are not the exported ones are `EXPORT_CHANGED` and nothing is sent. Then one `PUT <upload>` with `Authorization: Grant <token>`, `Content-Type: application/x-tar` and its exact `Content-Length`, at most two at once across the service, each bounded by `BEYOND_EXPORT_UPLOAD_TIMEOUT` milliseconds (120 s). A redirect is never followed. A package's state is `queued`, `uploading`, `stored` (a `2xx`), `failed` (a refusal with Snapshots' code, a redirect, changed bytes, an expired grant, or a destination that accepted no connection) or `unknown` (no answer within the bound, a connection that ended, a `5xx`, a cancellation): Snapshots may hold the package, and the client reads its state there before sending it again. A later transfer to the same capture names grants for the packages not stored only. Grants stay in memory and are never written to a record, an event or a log. Every change is announced as `export.changed` (`{export: {id, state, expires, capture?, transfer?}}`) on the development extension's `/events`, which a caller without `files.read` does not receive.

`BEYOND_SNAPSHOTS_ORIGINS` (origins separated by commas) names where uploads may go: https origins, or http ones on a loopback name (`127.0.0.1`, `[::1]`, `localhost` and every name under it, which RFC 6761 reserves for loopback, such as the local composition's `http://snapshots.beyond.localhost:<port>`); anything else fails the start. Without it every transfer is `EXPORT_DESTINATION`. A name under `localhost` is connected to `127.0.0.1`, where the suite's services listen, without asking the system resolver, which may answer `::1` first or only, or nothing; the address and its `Host` stay as given.

## The fallback interface

With `interface`, the API listener serves the build at `/ui/` (`/ui` redirects to `ui/`): a file with its media type and `nosniff`, a file under `assets/` cached for a year, anything else revalidated; a path without an extension answers `index.html`, a missing file with one is `404`, and no directory is listed. The page is sent with a content security policy for a static application (scripts, styles, fonts, workers, connections and frames of its own origin, inline styles, images also from `data:` and `blob:`, no plugins, no form targets, never framed). It pairs from the API's own origin like any interface, and the preview listener never serves it. The command line passes the build its installation carries (`ui/` beside `installation.json`) or the one `BEYOND_UI_DIR` names.

## Validation

```sh
node --test "service/test/*.test.mjs"     # the corrections, both listeners, callers, pairing, exports, the interface, capabilities
```

The cases compose the host's real `Hosts`, `Portable`, `Pairing`, `Exports` and `Attachments` with stand-ins of the routes that follow them in the host ([service/test/support/paired.mjs](../service/test/support/paired.mjs)), and a stand-in of Snapshots' archive route ([snapshots.mjs](../service/test/support/snapshots.mjs)). [tests/portable](../tests/portable/README.md) runs the real service started from this checkout (Engine through the bootstrap) with the development extension, and its browser probe pairs from HTTPS and plain HTTP pages in Chromium, Firefox and WebKit.

## Limits

- Behind a public origin, or on a non-loopback bind, a Node consumer needs the local credential, and BEE Node sends no request header: `beyond run <module>` and `beyond test` against such a service are refused until the loader can present it.
- A Node host that renders on the server reads its modules from the API listener as a local consumer, so the stylesheets its output links are addressed there, where a page reads nothing; a renderer cannot yet be given the preview origin for what it writes, so a page is given them on the preview listener at the same path (the command line's `boundaries` acceptance does so).
- A page served over HTTPS reaches `http://127.0.0.1` only where its browser allows it: WebKit refuses it as mixed content, and Chromium asks the person for local network access when the page's address is public ([the browser probe](../tests/portable/README.md)).
- A browser that sends no Fetch Metadata (older than Chrome 76, Firefox 90 or Safari 16.4) is not refused a classic script of the preview listener by another site; every current engine sends it.
- Another user of this machine is a local consumer like any process: it reads, without the credential, what a consumer reads.
- A loopback service that does not pair still runs a classic script another site loads from it (only reading across origins is refused there); `beyond test` and `beyond install` hold such a service only while they run.
- A browser that sends no fetch metadata (an old engine, or a plain-HTTP origin that is not a loopback one) and no `Origin` on a GET of the service's own origin looks like a process; on a loopback bind it is still a local consumer only when it names a loopback `Host`, and it reads nothing but what a consumer reads.
- A preview page of a pairing service reaches nothing privileged, and it still executes the code of the workspace and its dependencies in the person's browser on the preview origin.
- The private forwarding of a GitHub Codespaces port, which needs the person's GitHub sign-in on the forwarded origin, has not been exercised; nor has any hosted Packages interface.
