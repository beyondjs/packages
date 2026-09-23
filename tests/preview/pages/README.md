# Pages

Documents that the preview drivers serve themselves, besides the preview document of the service.

| Page | Used by | What it does |
| --- | --- | --- |
| `system.html` | `updates.mjs`, served by `system.mjs` at the root of an origin that forwards everything else to the development service | Loads SystemJS (`/systemjs/system.js`) and the service's import map for `System.register` modules (`/importmap.json?target=browser&format=system`), links the document's stylesheets listed by `/preview/entry.json`, registers the development runtime with the session options in `format=system`, and imports the entry module. Its expected behavior is the preview document's: the fixture element renders and every update is applied in place. |

The page reads everything it needs from the service at run time, so nothing is substituted in it.
