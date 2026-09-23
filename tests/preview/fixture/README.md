# Preview fixture

The workspace the preview drivers serve, copied beside the sources of the development runtime into a temporary directory (`beyond.json` lists `runtime`, `shared` and `web`). Nothing here is edited: every edit is made to the copy.

| Package | Entry module | What it holds |
| --- | --- | --- |
| `@fixture/web` | `./main` (`web/main/index.ts`), `platforms: ["web"]` | The application: importing it defines `fixture-counter` and adds one to the page. The element shows `greet('preview')` and `label(count)` in its shadow root, with a button that adds to the store. `store.ts` holds the count and records its evaluations in `window.evaluated`; `styles.ts` is the sheet the shadow root adopts; `view.ts` is `label`, the file the drivers edit, and redraws the elements when it is evaluated again; `page.scss` is the module's stylesheet, which the preview document links in its head and which sets the color of `body`. |
| `@fixture/shared` | `./text` (`shared/text/index.ts`), `platforms: ["node", "web"]` | `greet`, answering `[environment] Hello …`. The stand-in CDN of `index.mjs` serves another implementation that answers `[cdn] Hello …`, so a page shows where the module came from. |

Expected behavior: the page shows `[environment] Hello preview | Count: 0` and the button counts. The drivers edit `web/main/view.ts` (the label, a syntax error, a top-level `throw`), `shared/text/index.ts` (the greeting) and `web/main/page.scss` (the value of `$ink`, and `$missing`, an undefined variable that makes the stylesheet invalid).

Used by `index.mjs` and `updates.mjs`; `pages/system.html` loads the same application with SystemJS. The commands are in [the validation's README](../README.md).
