# Interface fixture

`build/` stands for the static build of the Packages interface that a development service serves at `/ui/` (`interface.test.mjs`): a page whose addresses are relative to it, as a build with a relative base writes them, a hashed script and stylesheet under `assets/` and an icon beside the page.

Expected: `/ui` redirects to `/ui/`; the page is served with its content security policy and `no-cache`; a file under `assets/` is cached for a year; a path without an extension (a route of the application, or a directory) answers the page and never a listing; a missing file with an extension is `404`; nothing outside `build/` is reachable.
