# Preview widgets fixture

The workspace of `widgets.mjs`, copied into a temporary directory beside the sources of the development runtime (`runtime`) and of the Widgets package (`widgets`), which the driver adds; `beyond.json` lists the six. Nothing here is edited: every edit is made to the copy.

| Package | Modules | What it holds |
| --- | --- | --- |
| `@fixture/ui` | `./global` (`global.scss`, published through `exports`), `./first`, `./second` | A package that publishes a shared stylesheet, which colors every paragraph of its widgets, and two widgets (`ui-first`, `ui-second`) |
| `@fixture/words` | `./source`, `./text` | Two modules that are not widgets: `source` exports `suffix` (empty) and `text` makes `phrase(name)` of it. `ui-first` writes `phrase('first')`, so an edit of `source` reaches it only through `text` |
| `@fixture/other` | `./third` | A widget (`other-third`) of a package that publishes no shared stylesheet |
| `@fixture/page` | `./main`, the entry | Imports the three widget modules, which registers their elements, and appends one of each to the page |

Each widget is written without a view framework: its controller links inside its root the stylesheets Widgets lists for it, removes those Widgets no longer lists, and writes one paragraph with its name.

Expected behavior: `first` and `second` are painted `rgb(10, 20, 30)` by the shared sheet; `third` keeps the default color. The driver edits `ui/global.scss` (the value of `$ink`, and `$missing`, an undefined variable that makes the sheet invalid), `words/source/index.ts` (the suffix) and `words/text/index.ts` (a `phrase` that throws, and a syntax error).
