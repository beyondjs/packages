# Portable connections validation

Runs the real development service of [portable connections](../../docs/portable.md), started from this checkout through `@beyond-js/packages/service` as the command line starts it: its supervisor prepares Packages with the bootstrap Engine and starts the host with the development extension. Nothing is a stand-in: the host, its two listeners, the access policy, the development extension compiled by Engine, pairing and exports are the ones of the checkout.

## Run

From the Packages directory, one file at a time (each starts its own service, whose first start compiles Packages with Engine, which takes minutes on a loaded machine):

```sh
node --test tests/portable/service.test.mjs
node --test tests/portable/unpaired.test.mjs
BEYOND_PLAYWRIGHT=<directory with playwright-core and its browsers> \
BEYOND_PROBE_REPORT=<file for the record> node --test tests/portable/browser.test.mjs
```

Prerequisites: Node 22.21.1 or later and the checkout's dependencies, its bootstrap included (`node_modules/@beyond-js/packages-bootstrap` linked to `bootstrap/`). `BEE_HTTP_TIMEOUT` is raised to 180 s for the loader of the host unless it is set. The probe also needs `playwright-core` with Chromium, Firefox and WebKit installed in the directory `BEYOND_PLAYWRIGHT` names, and `openssl` to make the certificate of its HTTPS pages.

## What each file establishes

| File | Established |
| --- | --- |
| `service.test.mjs` | A service that pairs: `/session` describes both listeners and the capabilities read from what it mounted, and never the local credential, whose file is readable by its user only; a local consumer reads without the credential and is refused sources and changes (`CREDENTIAL_REQUIRED`); a page of another site reads nothing, gets no answer to its preflight and writes nothing with a text body; the development extension parses a batch only as JSON and refuses `.git` and `.beyond` at any depth; a name made to resolve to this machine is refused on both listeners, preflights included; a request carrying the header of a proxy or a tunnel (`X-Forwarded-For`) is no local consumer (`CREDENTIAL_REQUIRED` on a module, the session and an attachment); the preview listener serves the preview and browser modules only, never with `*`, refuses a Node target, refuses a classic script of another site (`SITE_REFUSED`) while its own pages, an allowed origin and a navigation from anywhere are served, and answers everything else `404`; a paired page reaches the File API, receives source events the preview listener never sends, and its stream ends with `access.ended` `PAIRING_REVOKED`; exports of a member hold what its publication would, and `.` of a root without `package.json` is refused |
| `unpaired.test.mjs` | A service without pairing on the loopback address, as `beyond test`, `beyond install` and Conduict's runner start it: one listener, none of the pairing capabilities, no credential; cross-origin headers on compiled modules only, and there for a process and the service's own origin, not a page of another origin; a change of a page of another origin refused (`ORIGIN_REFUSED`), a bodyless `POST /builds` and its cancellation included, and an attachment of another site refused; the `Host` check, the JSON-only batch and `.git` at any depth; the path of Conduict's development proxy (loopback `Host`, the service's own `Origin`) still writes, starts a build and reads modules with `*` |
| `browser.test.mjs` | In Chromium, Firefox and WebKit: what pairing, reading the session and holding the event stream do from an HTTPS page with a self-signed certificate and from a plain HTTP page on a non-loopback address, recorded per engine; asserted in every engine, that a page of another site reads neither the session nor a source and writes nothing, that a page of another site (`http://localhost:<port>`, plain, so that no engine blocks it as mixed content) cannot load a module of the preview listener as a classic script while the preview's own page can, and that code in a preview reaches no source and cannot pair; recorded in Chromium, a page whose address is treated as public, as a hosted interface's is |

## Fixtures

[`fixtures/`](fixtures/README.md): the workspace the services serve and the page of the probe. The harness ([support/served.mjs](support/served.mjs)) copies the workspace into a unique temporary directory with its own `BEYOND_HOME`, writes `app/.env` there, holds the service as its owner and stops it by detaching, waiting for its record to be removed; [support/pages.mjs](support/pages.mjs) serves the probe's pages and makes their certificate for the run; [support/probe.mjs](support/probe.mjs) is what each page does in the browser.

## Not covered

Nothing hosted: no hosted Packages interface, no forwarded port of GitHub Codespaces and its sign-in, no real public address. The Chromium case of a public page is an address-space override of the browser, not a page of the internet. The command line's own acceptance against an installation is in its repository.
