# Preview widgets fixture

The workspace of `widgets.mjs`, copied into a temporary directory beside the sources of the development runtime (`runtime`) and of the Widgets package (`widgets`), which the driver adds; `beyond.json` lists the five. Nothing here is edited: every edit is made to the copy.

| Package | Modules | What it holds |
| --- | --- | --- |
| `@fixture/ui` | `./global` (`global.scss`, published through `exports`), `./first`, `./second` | A package that publishes a shared stylesheet, which colors every paragraph of its widgets, and two widgets (`ui-first`, `ui-second`) |
| `@fixture/other` | `./third` | A widget (`other-third`) of a package that publishes no shared stylesheet |
| `@fixture/page` | `./main`, the entry | Imports the three widget modules, which registers their elements, and appends one of each to the page |

Each widget is written without a view framework: its controller links inside its root the stylesheets Widgets lists for it, removes those Widgets no longer lists, and writes one paragraph with its name.

Expected behavior: `first` and `second` are painted `rgb(10, 20, 30)` by the shared sheet; `third` keeps the default color. The driver edits `ui/global.scss`: the value of `$ink`, and `$missing`, an undefined variable that makes the sheet invalid.
