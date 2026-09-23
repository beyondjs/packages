# Unified-runtime fixture

A workspace of two packages composed against the development runtime, which the drivers copy beside the runtime's sources into a temporary directory (`beyond.json` lists `runtime`, `shared` and `app`; `runtime` is the copy). Nothing here is edited: every edit is made to the copy.

| Package | Entry module | What it holds |
| --- | --- | --- |
| `@fixture/shared` | `./text` (`shared/text/index.ts`) | `format` and `store` re-exported from internal modules, `greet`, which reads `./format` on each call, `captured`, computed once when the entry is evaluated, and the stylesheet `text.scss`. `count.ts` counts evaluations of each file in `globalThis.evaluations`. |
| `@fixture/app` | `./main` (`app/main/index.ts`) | `main`, `direct` and `add`, which reach `@fixture/shared/text` only through its bare specifier |

Both packages select the `ts` bundler with `runtime: "@beyond-js/local-2026/bundle"` and build for `node` and `web`.

Expected behavior: `main()` answers `[app] Hello World!`, `direct()` `[app] Hi there!`, and `add()` counts from 1. The drivers edit `shared/text/format.ts` (the punctuation of `format`, a syntax error, a top-level `throw`), `shared/text/index.ts` (the greeting) and `shared/text/text.scss` (the value of `$ink`, and `$missing`, an undefined variable that makes the stylesheet invalid), each in the temporary copy.

Used by `index.mjs`, `service.mjs` and `environments.mjs`; the commands are in [the validation's README](../README.md).
