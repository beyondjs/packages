# The backend profile: what a backend run from a CDN release may contain

A backend is a package whose entry public module a host runs straight from a CDN release: on Node with BEE Node's `resolution` adapter, or on Deno with the release's import map. Nothing is installed, no image is built for the application, and the host only imports the entry. This guide says what such a backend does, how it is written, what preparation supports for it, and what four common servers do when they are prepared and run this way.

The host and its descriptor are the Beyond Suite's `docs/products/packages/execution.md` (`beyond-backend-execution/1`, a proposal no product reads yet); CDN's backend targets and their release documents are CDN's. What is said here is executed locally unless it says otherwise, and nothing of it is hosted.

## The host contract

A host runs the entry of the backend target once. The backend:

- **starts serving when it is imported**: its top-level code listens, so the host's launcher is `await import('<entry>')` and nothing else;
- listens on **`HOST`** (`127.0.0.1` by default; a host sets `0.0.0.0`) and **`PORT`**;
- answers **`GET /health`** with 200 once it serves;
- on **`SIGTERM`** accepts no new connection and exits once the open requests finish, **within 10 seconds**;
- reads its settings from the environment and **writes no file**.

In development, `beyond run --target <application>/<target>` runs the same entry under the development service and forwards `SIGTERM` and `SIGINT` to it, and a target's readiness is the text its output says (`readiness: {output}` of `beyond.json`, [applications](applications.md)). A host polls `GET /health`. Both are declared by the templates below.

## Writing one

Two forms are prepared alike:

| Form | What it is | Where to start |
| --- | --- | --- |
| A Beyond package of modules | `beyond.modules`, the `ts` bundler, a `source` publication; a library module with the request logic, tested with `beyond test`, and a server module that serves once imported | The command line's `backend` template (`beyond create backend <name>`), the agent plugin's `backend` template version 2 |
| An ordinary npm package | `"type": "module"` and `exports` naming a `.ts` or `.js` entry, frameworks from npm as `dependencies` at exact versions | The `backend` cloud template ([templates/cloud](../templates/cloud/README.md)): `package.json`, `routes.ts`, `server.ts` |

Rules for the code, each of which a run below exercised:

- Import builtins with their `node:` scheme. Preparation writes them so anyway ([Node outputs](cdn-outputs.md#node-outputs-builtins-and-optional-packages)), but the source then reads the same in every runtime.
- Take `setTimeout` and `setInterval` from `node:timers` when you call `unref()` on them: Deno's global timers before 2.9 return numbers (`setTimeout(...).unref is not a function`).
- Drain with `server.close()` and close each kept-alive connection once its response ends (`server.closeIdleConnections()` every 100 ms while closing), with a fallback exit below 10 s. A kept-alive connection otherwise holds the exit for the server's keep-alive timeout (5 s in Node, 4.2 s measured), and Fastify's own close for 8 s.
- No `__dirname`, `__filename`, native addons (`.node`) or files read beside the code: a release has none of them.
- No module loaded by a computed name (`require(name)`, `import(name)`): preparation refuses it unless it is declared, and even declared it throws when it runs.

## What preparation supports

What a backend's dependencies may contain is what [the outputs guide](cdn-outputs.md#ordinary-npm-packages) lists for npm packages, with two rules of their own for Node outputs since `Toolchain.BOUNDARY` 2 and `Toolchain.SHARING` 2:

| Shape | Outcome |
| --- | --- |
| CommonJS and ES module packages | Converted to ES modules; no `npm install`, no lifecycle script |
| A builtin, required or imported, bare or with `node:` | Written `node:<name>`; its `require` returns its default export |
| A guarded `require` of an optional package the release does not hold (`debug` → `supports-color`) | Throws `MODULE_NOT_FOUND` when it runs, when the manifest declares it optional (`optionalDependencies`, `peerDependenciesMeta`). Undeclared: `DEPENDENCY_UNRESOLVED` |
| Subpaths of one package that share files (`svelte`) | One carrier and its facades. An adapter that reaches a generic subpath only through its entry point carries nothing (`hono/bun` over `hono/router`) |
| `require(expr)`, `import(expr)` | `DYNAMIC_IMPORT_UNKNOWN`; declared, it passes and still throws `Dynamic require of "…" is not supported` when it runs |
| `__dirname`, `__filename` | Free identifiers: a `ReferenceError` where evaluated |
| `.node` addons, JSON and WebAssembly loaded at run time | Not supported |

## What runs where

Measured on 2026-11-07 with CDN's frameworks acceptance (`acceptance/frameworks.mjs` in the CDN repository): each case is published in a registry of the run, which passes every other name through to registry.npmjs.org, and prepared as a backend target by the CDN worker image's own unit children (`resolve`, `fetch`, `analyze`, `generate`, with the worker's payloads, confined); its outputs and the release's `resolution.json` and `importmap.json` are laid out under `/_r/1/` as an application host serves them, and a host runs the entry with BEE Node's `resolution` adapter and with Deno. The worker image is CDN `2b9ed15` (A-29's confined worker) with this repository at the revision named below; BEE Node `e869324` on Node 22.21.1; one loaded shared machine, loopback network, cold caches. It is not CDN's service, database, job lifecycle or published delivery, and nothing is hosted.

Each cell is the time from the host's start to `GET /health` answering 200, then the time from `SIGTERM` to the exit, with a `GET /slow` (1.5 s) sent before the signal finishing every time. Preparation is the four stages' wall time, every unit a fresh container of the worker image.

**This revision** (`d0e0b51`, `Toolchain.SHARING` 2, `Toolchain.BOUNDARY` 2):

| Case | Preparation | Node 22.21.1, BEE Node | Deno 2.9.6 | Deno 2.5.6 |
| --- | --- | --- | --- | --- |
| `node:http` | 1 package, 1 module, 12 s | 486 ms; exit 0 in 1.2 s | 263 ms; exit 0 in 1.2 s | 180 ms; exit 0 in 1.2 s |
| Hono 4.13.16 with `@hono/node-server` 2.1.6 | 3 packages, 6 modules, 28 s | 522 ms; exit 0 in 1.2 s | 374 ms; exit 0 in 1.2 s | 235 ms; exit 0 in 1.2 s |
| Fastify 5.12.8 | 49 packages, 51 modules, 53 s | 529 ms; exit 0 in 1.2 s | 433 ms; exit 0 in 1.2 s | 391 ms; exit 0 in 1.2 s |
| Express 5.3.0 | 69 packages, 93 modules, 88 s | 687 ms; exit 0 in 1.2 s | 937 ms; exit 0 in 1.2 s | 562 ms; exit 0 in 1.2 s |
| The agent plugin's `backend` template 2 (`ts` bundler, Kernel 0.1.14) | 2 packages, 3 modules, 16 s | 480 ms; exit 0 in 21 ms | 332 ms; exit 0 in 16 ms | 169 ms; exit 0 in 18 ms |

**Before it**, the same cases with this repository at `e881a98` (the revision CDN's confined worker pins) and at `c04d5d9` (the one CDN's production worker runs) answered alike:

| Case | Outcome | Diagnostic |
| --- | --- | --- |
| `node:http`, the template | Run on all three hosts | — |
| Hono | Prepared; fails on every host when `hono` is imported | `ReferenceError: Bun is not defined` at `hono@4.13.16/modules/bun`: the sharing plan made `hono/bun` the carrier of `hono/router` and `hono/ws`, so importing `hono` evaluated the Bun adapter (`var {write} = Bun`) |
| Fastify | Runs on Node and Deno 2.9.6; fails on Deno 2.5.6 | `TypeError: Import "module" not a dependency and not in import map from ".../pino@10.4.0/modules/~root…"`: a bare builtin |
| Express | Fails at analysis | `DEPENDENCY_UNRESOLVED`: `Module "debug": "…:debug@4.4.3" imports "supports-color", which is not in the pinned graph. Declare the dependency and resolve the graph again`; without its declaration also `DYNAMIC_IMPORT_UNKNOWN`: `Module "express" loads a module that cannot be known from its code (lib/view.js:81: var fn = require(mod).__express)` |

With this revision but before a `require` of a builtin returned its default export, Fastify and Express also failed on Deno 2.5.6 with `TypeError: The "superCtor.prototype" property must be of type object. Received undefined` (`util.inherits(SonicBoom, require('events'))` in `sonic-boom`), and the fixtures' own `setTimeout(...).unref()` with `TypeError: setTimeout(...).unref is not a function` until they took their timers from `node:timers`.

Express's registration declares its view loader's `require(mod)` (CDN's `declared` member, which needs at least one public module: it names `express`, already in the graph); its views stay unsupported.

## Builtins: the decision

Preparation writes every builtin of a Node output with its `node:` scheme. The evidence:

- **It is what lets Deno before 2.9 run a release.** With `e881a98`, Fastify on Deno 2.5.6 stopped at `TypeError: Import "module" not a dependency and not in import map` (a bare builtin); with the scheme written, and a builtin's `require` returning its default export, all five cases run on Deno 2.5.6. Deno 2.9 and later, Node and BEE Node read both spellings, and the other runtimes with Node's builtins that read only the scheme read these outputs too.
- **It changes nothing else.** Builtins are never inventory items, edges or resolution entries, so an inventory, a release's resolution documents and a graph are the same; only the bytes of Node outputs change.
- **Its cost is one regeneration.** The key of every Node output of the selected compiler (source and npm forms) includes `Toolchain.BOUNDARY`, now `2`, so a CDN that moves to this revision reuses none of the Node outputs it stored before: each is generated again the first time a preparation needs it, and stored under its new key. Browser outputs, composed outputs (`Toolchain.COMPOSITION`) and distributions keep their keys and their reuse. Every npm output (browser and Node) changes key once more for `Toolchain.SHARING` 2.

## Not established

- A hosted execution service, a descriptor-driven host and Delegate's adoption (the Beyond Suite's `docs/products/packages/execution.md`).
- A private release: BEE Node presents no credential, so only a public release runs today, which delivers its sources to anyone with the address.
- Express views, and any module that loads another by a computed name.
- Readiness by `GET /health` in the development service: `beyond-launches/1` reads a target's output.
