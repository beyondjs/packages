# Confinement fixtures

The packages [the confinement validation](../README.md) traces and generates, and the files outside them they reach for. The harness ([store.mjs](../support/store.mjs)) copies `outside/` and every package into a unique temporary directory, each package under `packages/<group>-<directory>` (`packages/hostile-tailwind`, `packages/clean-plain`), so a path that climbs three levels from a module directory, or two from a package root, reaches `outside/`. It never writes these files.

Two things a checked-in fixture cannot carry are made in the copy:

- `__OUTSIDE__` is replaced by the absolute location of the copied `outside/`, in the files that name it.
- The links the hostile cases need are created, each leading into `outside/`: `hostile-inputs/linked/styles.css` → `secret.css`, `hostile-tailwind/sources/parts` → `parts/`, `hostile-esbuild/linked.json` → `secret.json`, `hostile-assets/linked.txt` → `secret.txt`.

The installed packages the fixtures reference (`@beyond-js/kernel`, the runtime the composed modules import, and `vue` and `svelte`, which their components import) are copied from the installation, as a fetch of their sources would leave them; they are not fixtures. Each package depends on the packages its manifest names.

## `outside/`

Files no package may read in a confined compilation. Each carries the value `CONFINEMENT_SECRET_7d1f`, which the validation looks for in every result: `secret.css`, `_secret.scss`, `secret.json`, `secret.txt` (not JSON, so a configuration or a source map comment that names it fails with its first token), `secret.cjs` (a CommonJS module that exports a name), `secret.js.map` (a source map whose source content is the value), `types.ts` (a type whose property is named by the value) and `parts/view.ts` (a source whose Tailwind class carries the value). `other.json` carries no value: it is one more name a pattern import would list.

## `hostile/`

Packages that reach for code or files a confined compilation refuses. Composed packages declare the `ts` bundler and Beyond sources; the others are ordinary npm packages compiled by the selected compiler.

| Package | Module | What it does | Expected when confined |
| --- | --- | --- | --- |
| `@fixture/tailwind-hostile` | `plugin` | `@plugin "./plugin.mjs"`, a plugin that writes a marker and connects to the probe | `PLUGIN_REFUSED`, the plugin never runs |
| | `config` | `@config "./tailwind.config.mjs"`, a configuration that does the same | `PLUGIN_REFUSED` |
| | `absolute` | `@import "__OUTSIDE__/secret.css"` | `SOURCE_CONFINED` |
| | `escape` | `@import "../../../outside/secret.css"` | `SOURCE_CONFINED` |
| | `sources` | Declares the Tailwind source `parts`, a link to `outside/parts` | `SOURCE_CONFINED` |
| `@fixture/sass-hostile` | `absolute`, `escape` | `@use` of `__OUTSIDE__/secret` and of `../../../outside/secret` | `SOURCE_CONFINED` |
| `@fixture/inputs-hostile` | `linked` | Its stylesheet input `styles.css` is a link to `outside/secret.css` | `SOURCE_CONFINED` |
| | `path` | Its manifest sets the inputs `path` to `../../../outside` | `SOURCE_CONFINED` |
| `@fixture/bundler-hostile` | `widget` | The package registers its `ts` bundler as a `data:` URL that writes a marker and connects | `PLUGIN_REFUSED`, nothing is imported |
| `@fixture/processor-hostile` | `widget` | The module manifest sets `specifier` to a `data:` URL program | `PLUGIN_REFUSED`, nothing is imported |
| `@fixture/legacy-hostile` | `widget` | Selects the toolchain's exports bundler, registered as `legacy`, with `node.require` naming `__OUTSIDE__/secret.cjs`; that bundler compiles the file a manifest names | `PLUGIN_REFUSED`: only the `ts` bundler composes a module confined. Unconfined, on Node, it compiles and writes nothing into the working directory |
| `@fixture/esbuild-hostile` | `absolute`, `escape`, `text` | Imports `__OUTSIDE__/secret.json`, `../../outside/secret.json`, `__OUTSIDE__/secret.txt` | `SOURCE_CONFINED` |
| | `linked` | Imports `./linked.json`, a link to `outside/secret.json` | `SOURCE_CONFINED` |
| | `styles` | Imports a stylesheet whose `@import` is `__OUTSIDE__/secret.css` | `SOURCE_CONFINED` |
| | `reexport` | `module.exports = require('../../outside/secret.cjs')` | `SOURCE_CONFINED` |
| `@fixture/tsconfig-hostile` | `.` | Its `tsconfig.json` extends `__OUTSIDE__/secret.txt` | Compiles without reading it |
| `@fixture/assets-hostile` | `.` | Declares the static file `linked.txt`, a link to `outside/secret.txt` | `SOURCE_CONFINED` for the file |
| `@fixture/maps-hostile` | `comment`, `styled` | `//# sourceMappingURL=../../outside/secret.txt` in JavaScript, `/*# … */` in CSS | Compiles without the map |
| | `mapped` | Names `../../outside/secret.js.map`, a map whose source content is the value | Compiles without the map |
| | `inline` | An inline map whose source `../../outside/secret.txt` carries no content, which the compiler would read | Compiles without the map |
| | `kept` | `kept.js.map` beside it, with the content of its source | Compiles with the map, as unconfined |
| `@fixture/globs-hostile` | `template`, `concat` | ``import(`../../outside/${name}.json`)``, `require('../../outside/' + name + '.json')` | `SOURCE_CONFINED` once, no outside file named |
| | `climb` | ``import(`./locales/${name}/../../../../outside/secret.json`)``, which climbs after its substitution | `SOURCE_CONFINED` once |
| | `local` | ``import(`./locales/${name}.json`)``, with `locales/en.json` | Compiles, the pattern expanded |
| `@fixture/vue-hostile` | `typed` | `<script setup>` with `defineProps<Secret>()`, `Secret` imported from `outside/types.ts` | `VUE_SCRIPT_ERROR`, nothing of the type read |
| | `blocks` | `<template src>` and `<style src>` naming outside files, and a style block that `@import`s one | Compiles, nothing read |
| `@fixture/svelte-hostile` | `view` | Imports `outside/secret.json` and `@import`s `outside/secret.css` | Compiles, nothing read: both stay references |
| `@fixture/shadow-hostile` | `widget` | Ships `node_modules/@beyond-js/packages/bundlers/ts` and its `processors/styles`, each writing a marker if it runs; registers the allowed `ts` bundler | Compiled by the toolchain's bundler and processor, confined or not; no marker. This `node_modules` is checked in: the repository's `.gitignore` re-includes it by name |

Without confinement, the plugin runs and `tailwind-hostile/escape`, `sass-hostile/escape`, `inputs-hostile/linked` and `esbuild-hostile/escape` read the file outside their package, which is the development behavior the validation checks is unchanged.

## `clean/`

Packages that compile confined exactly as they do without it.

| Package | Module | What it uses |
| --- | --- | --- |
| `@fixture/clean-styles` | `tailwind` | `@import "tailwindcss"` with the declared source `view.ts`, whose `flex p-4` become utilities; Tailwind's stylesheets are read from the toolchain |
| | `scss` | `@use "tone"`, the partial `_tone.scss` beside it |
| `@fixture/clean-plain` | `.` | A JSON import, a stylesheet with a relative `@import`, and the static file `logo.svg` |
| | `view` | TSX compiled with `jsxFactory: "h"`, which its `tsconfig.json` takes from `tsconfig.base.json` inside the package |
