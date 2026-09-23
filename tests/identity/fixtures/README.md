# Identity fixtures

Two Beyond source packages whose Vue and Svelte components sit at the **same path inside their modules**, which is what the [identity validation](../README.md) needs to show that a compiled component is identified by its source and not by a path.

| Package | Module | What it holds |
| --- | --- | --- |
| `@fixture/shell` | `entry` | The entry point: imports both widgets and places their elements |
| | `vue` | Widget `shell-vue`: `view.vue`, a red `.title`, rendering the library's and the panel's components |
| | `panel` | A module of the same package: `view.vue`, a blue `.title` |
| | `svelte` | Widget `shell-svelte`: `view.svelte`, a red `.title`, rendering the library's and the panel's components |
| | `spanel` | A module of the same package: `view.svelte`, a blue `.title` |
| | `tw` | A module whose stylesheet Tailwind generates from the classes of `index.ts` |
| `@fixture/kit` | `vue`, `svelte` | The library: `view.vue` and `view.svelte`, a green `.title` |

Every component styles the same class, scoped to itself: Vue with `<style scoped>`, Svelte with its component styles. Rendered in one page, each title keeps its own colour only if the three components have three scopes. The validation also pins `@fixture/kit@1.0.0` from four origins — npm, another host and two registries under one host that differ by path — from the same files.

Nothing here is a package of the Packages workspace: the validation copies both packages into a store of its own, declares them pinned, and never edits these files.
