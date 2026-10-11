# Portable connection fixtures

Used by the validations of [tests/portable](../README.md), which copy them into a unique temporary directory and never write them.

| Path | What it is |
| --- | --- |
| `workspace/` | A `beyond.json` workspace of `@portable/app` 1.0.0 and the development runtime (`runtime`, which the harness copies in), served by the real development service with the development extension. `./main` (`platforms: ["web"]`) writes `greet('preview')` into `document.body.dataset.greeting` when the preview imports it; `./text` (`platforms: ["node", "web"]`) is `greet`, answering `Hello …`. Both are assembled against the development runtime (`runtime` of the `ts` bundler), so a preview needs no CDN. |
| `pages/probe.html` | The page an interface origin serves in the browser probe: the probe pairs, reads the session and holds the event stream from it, in Chromium, Firefox and WebKit. |

What the harness adds to the copy: `runtime/`, the manifest and the exported module directories of the development runtime (`@beyond-js/local-2026`) from `BEYOND_RUNTIME`, or the suite's `local-2026` checkout beside this repository; and, inline, `app/.env` (a file named as a secret, read by a paired page and refused to any other) and the files a case edits or tries to write. Nothing here is compiled by Packages' own build: `beyond.json` of the repository names only its root package.

Expected behavior: the service builds both modules; the preview of `@portable/app/main` sets `data-greeting="Hello preview"` on the body of the page.
