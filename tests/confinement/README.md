# Confinement validation: compiling sources the caller does not trust

A preparation for delivery compiles packages whose author it does not trust: a package from a registry, or one captured from a person's computer. It selects a **confined compilation** (`confined: true` in the analysis and the generation request, [the outputs guide](../../docs/cdn-outputs.md#confined-compilation)), and in it no code a package supplies is loaded and no file outside a package is read. This validation executes that, with the real processors and the real compiler, and checks that the same packages compile as before when the caller does not select it.

The fixtures are copied into a unique temporary directory for every run; read [their README](fixtures/README.md). Nothing is downloaded, no service is started and nothing is written outside that directory.

## What each case establishes

[confinement.test.mjs](confinement.test.mjs) checks what a source names:

| Case | Established |
| --- | --- |
| refused | Each hostile module of the fixtures, traced and generated confined, answers its code (`PLUGIN_REFUSED` for a Tailwind plugin or configuration, a bundler or a processor the package names, and a toolchain bundler other than `ts` composing a module; `SOURCE_CONFINED` for a Tailwind or Sass import of an absolute path or of a path that leaves the package, Tailwind sources and a stylesheet input reached through a link, inputs whose directory leaves the package, an absolute import, an import that leaves the package, an absolute text import, an import of a link, a CSS `@import` of an absolute path and a CommonJS re-export that leaves the package). Nothing is generated, no marker of the code that would have run exists, no connection reaches the probe, and no value of the files outside the packages appears in an inventory, an output or a diagnostic |
| static file | A static file that is a link leaving its package is `SOURCE_CONFINED` in the trace and in the generation of its item |
| TypeScript configuration | A configuration that extends a file outside the package compiles confined without reading it; unconfined, the compiler still reads it and discloses its first token in its error, which is what confinement prevents |
| clean packages | Tailwind (its stylesheets read from the toolchain), a Sass partial, a JSON import, a CSS `@import`, a static file and a base configuration inside the package compile confined, and the provenance of the outputs says `confined: true` |
| keys | Every item of a confined trace has a key of its own, different from the unconfined one, and an unconfined key and provenance are unchanged |
| declaration processor | A `Package` read confined refuses the processor of its `types` conditional (`PLUGIN_REFUSED`), whose program is not confined; read without confinement, the declaration builds |
| unchanged development behavior | Unconfined, the Tailwind plugin runs (its marker and its connection arrive), and a stylesheet, a Sass partial, a linked input and a JSON file outside the package are read |

[compilers.test.mjs](compilers.test.mjs) checks what the compilers reach on their own:

| Case | Established |
| --- | --- |
| input source maps | A JavaScript or CSS file whose `sourceMappingURL` names a file outside the package, a map outside the package, or an inline map whose sources are outside and carry no content compiles confined without that map, with a map of its own; nothing outside reaches the inventory, the outputs, the maps or the diagnostics. Unconfined, the compiler reads them: the first token of a file appears in its error and an outside source in the output map |
| kept input map | A map inside the package that carries the content of its sources is kept: the confined output map is the unconfined one |
| pattern imports | A template or concatenated `import()`/`require()` whose fixed beginning leaves the package, or that climbs after a substitution, is one `SOURCE_CONFINED`, and no file outside the package is named in any diagnostic; a pattern inside the package is expanded as before, and unconfined the escaping one is too |
| Vue types | A `<script setup>` whose props use a type from outside the package is `VUE_SCRIPT_ERROR` and reads nothing of it, and blocks that name files outside (`src`, `@import`) read nothing; unconfined, the type's properties become props as before |
| Svelte | A component that imports a file outside the package and `@import`s an outside stylesheet compiles and reads neither |
| shadowed implementations | A package that ships its own `@beyond-js/packages/bundlers/ts` and `…/processors/styles` under `node_modules` is compiled by the toolchain's, confined or not: their markers never appear |
| exports bundler | Composing a module with the exports bundler writes no `output.js` into the working directory |

## Run

Prerequisites are those of [the stage-1 validation](../stage-1/README.md), without the watchers service. The installed packages the fixtures reference (`@beyond-js/kernel`, `vue`, `svelte`) are copied from `BEYOND_MODULES`, by default this repository's `node_modules`. `BEYOND_ESBUILD` selects the compiler as in the other groups. Each file runs in a process of its own:

```sh
cd "$PACKAGES_DIR"
BEE_URL=http://localhost:1112 \
  node --import "$BEE_NODE_DIR/register.mjs" --test tests/confinement/confinement.test.mjs
BEE_URL=http://localhost:1112 \
  node --import "$BEE_NODE_DIR/register.mjs" --test tests/confinement/compilers.test.mjs
```

Expected: 8 tests pass in each file (the run and its 7 cases).

## The probe

The code a confined compilation must never run is the fixture's own: a Tailwind plugin, a Tailwind configuration, a bundler and a processor written as `data:` URLs, and the copies of a bundler and a processor a package ships. When it runs, it writes a file whose name starts with `BEYOND_CONFINEMENT_MARKER` and opens a connection to `BEYOND_CONFINEMENT_PORT`; [the probe](support/probe.mjs) sets both, to a file of the run's directory and to a loopback port it allocates and listens on. The files outside the packages carry one value, `CONFINEMENT_SECRET_7d1f`, which a confined result never contains.

## Not covered

Operating-system isolation of the process that compiles: a confined compilation runs in the process of its caller, with that process's user and network, and the rules are enforced by the toolchain's own resolution. The semantic diagnostics of a module (`@beyond-js/packages/diagnostics`) confine their reads on their own and are validated by [cdn-diagnostics](../cdn-diagnostics/README.md). The `types` conditional, which a preparation does not build, is not confined: its declaration processor is refused in a confined compilation instead.
