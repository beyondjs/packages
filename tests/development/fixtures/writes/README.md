# Writes fixture: a Vue component and a stylesheet edited in quick succession

The workspace `writes.test.mjs` serves, watched by the real watchers service (read [the development tests](../../README.md)). [`support/watched.mjs`](../../support/watched.mjs) copies this directory into a unique temporary directory and edits the copy; nothing here is written by a run.

| Package | Module | What it is for |
| --- | --- | --- |
| `@fixture/writes` 0.1.0 (`ui/`), `ts` bundler on the development runtime | `./view`, `web` and `node`: `index.ts` exports the component of `view.vue`, whose `<style scoped>` block is one stylesheet, and `view.css` is the stylesheet of the module | The sources the test breaks and corrects |

## Expected behavior

- Unedited, `@fixture/writes/view` is valid for Node, which is what the state of the service builds for a module that declares `node`.
- `view.vue` with `<div></template>` in place of `</template>` does not parse: the module is invalid with `VUE_PARSE_ERROR`.
- `view.css` followed by `.broken { color: ` does not compile: the module is invalid with a `STYLE_` diagnostic.
- Writing the original bytes back makes the module valid again, however soon after the failure they are written.

`vue` is declared in `ui/package.json` and resolved by the environment that executes the artifact; the test only builds the module, so nothing is installed.
