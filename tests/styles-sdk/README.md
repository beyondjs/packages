# Styles and SDK validation: stylesheets, framework sources, declarations and watched invalidation

Validates what the TypeScript bundler produces from a module with CSS, SCSS, Tailwind, Vue and Svelte sources, a widget declaration, a stylesheet exported by the package and per-conditional entries, and how watched edits of sources, partials, a shared theme and Tailwind candidates invalidate exactly the affected module. It runs on a temporary copy of [`fixture/`](fixture) under BEE Node against the bootstrap Engine, with the real watchers service, and executes nothing in a browser: that is the `web` acceptance of the command line.

Prerequisites: those of [the stage-1 validation](../stage-1/README.md) (Engine serving this implementation on 1110–1112, Engine serving the watchers utility on 1120, BEE Node), and the compilers this package declares (`sass`, `tailwindcss`, `@tailwindcss/oxide`, `vue`, `svelte`) installed in `node_modules`.

```sh
BEE_URL=http://localhost:1112 WATCHERS_URL=http://localhost:1120 \
  node --import "$BEE_NODE_DIR/register.mjs" tests/styles-sdk/index.mjs
```

Expected: `14/14 steps passed`.

| Step | What it establishes |
| --- | --- |
| discovery | The fixture declares eight modules, including the `./global` stylesheet exported by the package, and nothing else |
| web build | Every module builds; the stylesheets are written beside the artifacts |
| scss | A module stylesheet compiles its SCSS with its partial and concatenates its CSS in file order, with a map that names the sources |
| tailwind | Only the declared sources are scanned, a theme outside the module is inlined, and the utilities of the candidates are emitted; the discovered dependencies are watched |
| vue | A component becomes its script, render and facade internal modules; its style blocks, scoped and global, join the stylesheet |
| svelte | A component becomes one internal module with external CSS, against the Svelte 5 client runtime |
| widget | The artifact registers the element with `global: true` before it initialises and declares itself a widget with styles; the global sheet is compiled from its entry alone |
| conditionals | The web and node entries of one public module differ, and each excludes the other side |
| types | Public declarations keep public type imports, hide internals, and a semantic error names its file and position |
| kernel families | A source written against `@beyond-js/kernel/core` is assembled against the selected runtime |
| watch, tailwind | Adding a class to a declared source adds its utility; removing it removes the utility |
| watch, dependencies | A partial and a theme outside the module invalidate the modules that read them, and only those |
| watch, failure and recovery | An invalid stylesheet reports its position and publishes nothing; its correction restores the output |
| watch, deletion | Removing the last stylesheet of a module removes its stylesheet output |
