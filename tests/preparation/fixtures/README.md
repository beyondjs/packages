# Preparation fixtures

The application of the preparation validation is `../fixture/` (`@fixture/cards`), described in [the validation's README](../README.md): four widgets, one per family, a package that publishes a shared stylesheet (`./global` → `global.css`, whose `:host` rule outlines every widget element from inside its root) and `./tone` → `tone.css`, which the `html` widget selects with `@fixture/cards/tone.css`. The entry selects `@fixture/cards/global.css`.

This directory holds the packages [`styles.test.mjs`](../styles.test.mjs) adds to the store beside it. The harness copies them into a temporary store and never writes them.

## `bare/` — `@fixture/bare`

Beyond sources composed by the `ts` bundler over the development runtime, with **no** `./global`.

| Module | What it is | Expected |
| --- | --- | --- |
| `badge/` | A widget (`bare-badge`) with its own `styles.scss` | Traced alone, it reaches its own stylesheet and no shared sheet; its code relates `widget: true` and no `global` |
| `wrong/` | Imports `@fixture/cards/global` without `.css` | `OUTPUT_NOT_FOUND`, whose message names `@fixture/cards/global.css` |
| `binding/` | `import sheet from '@fixture/cards/global.css'` | `STYLE_BINDING_UNSUPPORTED` |
