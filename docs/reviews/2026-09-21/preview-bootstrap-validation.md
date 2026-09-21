# Preview bootstrap and runtime distribution, 2026-09-21

Executed evidence for two changes of the preview (see the [development contract](../../development-contract.md#preview-entry)): the document now gives the development runtime the part of the session it needs, so a visitor's grant no longer includes `session.read`; and a runtime that the workspace does not contain but the installation provides has its coordinator addressed on the CDN, so a project created from the Workspace template applies updates to an open preview. Nothing was committed, published or hosted.

Paths are variables: `$SUITE_DIR` holds the component checkouts, `$BEE_NODE_DIR` the BEE Node checkout, `$TOOLCHAIN` an installation built by the command line's acceptance installer, `$PLAYWRIGHT_DIR` a directory with `playwright-core`, `$CDN_DIR` a directory written by `tests/preview/cdn.mjs`.

## Environment

| Component | Version |
| --- | --- |
| Packages | 0.0.1, working tree of `feature/next` over `202e3ab` with these changes |
| Development runtime (`local-2026`) | 0.1.0, working tree over `ee70038`: `local.register` accepts a `session` |
| Workspace template | 0.2.0, working tree over `4ccaea8`: the application selects `@beyond-js/local-2026/bundle` |
| Command line | working tree over `374fb37`: its acceptance installer installs the runtime beside Packages |
| Browser | Chrome 153.0.8010.52, headless |

## What was run

```sh
cd "$SUITE_DIR/packages"
node --test contracts/development/test/fixtures.test.mjs
BEE_URL=http://localhost:1112 node --import "$BEE_NODE_DIR/register.mjs" tests/development/index.mjs
BEYOND_PLAYWRIGHT="$PLAYWRIGHT_DIR" BEYOND_ESBUILD="$SUITE_DIR/beyond-esbuild" BEE_URL=http://localhost:1112 WATCHERS_URL=http://localhost:1120 \
  node --import "$BEE_NODE_DIR/register.mjs" tests/preview/index.mjs
BEYOND_ESBUILD="$SUITE_DIR/beyond-esbuild" BEE_URL=http://localhost:1112 WATCHERS_URL=http://localhost:1120 \
  node --import "$BEE_NODE_DIR/register.mjs" tests/unified-runtime/index.mjs     # and tests/unified-runtime/service.mjs
BEYOND_ESBUILD="$SUITE_DIR/beyond-esbuild" BEE_URL=http://localhost:1112 WATCHERS_URL=http://localhost:1120 \
  node --import "$BEE_NODE_DIR/register.mjs" tests/preview/cdn.mjs "$CDN_DIR"
node "$SUITE_DIR/cli/acceptance/install.mjs" "$TOOLCHAIN"
BEYOND_TEMPLATE="$SUITE_DIR/workspace-template" BEYOND_TOOLCHAIN="$TOOLCHAIN" BEYOND_PLAYWRIGHT="$PLAYWRIGHT_DIR" \
  BEYOND_TEST_CDN_DIRECTORY="$CDN_DIR" node tests/preview/template.mjs
cd "$SUITE_DIR/cli" && node acceptance/index.mjs "$TOOLCHAIN"
```

## Results

| Run | Observed |
| --- | --- |
| Fixtures | 49/49: the valid description with a coordinator carries `updates.session`; a coordinator without it, and a session module carrying a `base` location, are invalid |
| Development contract | 20/20. With a CDN origin configured, a Kernel project still reports `updates.reason`, and nothing asks the CDN for a Kernel coordinator |
| Preview in a browser | 9/9 with a visitor grant of `events.subscribe` and `artifacts.read` only: `/session` answered `403` to it; the document embeds the session, names no `file:` location nor the workspace root, and the update was applied to the running page through the gateway |
| Unified runtime | 6/6 and 7/7: Node consumers, which read `/session`, are unchanged |
| `cdn.mjs` | wrote `bundle` (68 kB) and `main` (43 kB) of `@beyond-js/local-2026@0.1.0`. The service builds development output only and answers `OPTION_UNSUPPORTED` for `env=production`, so a stand-in serves the development build |
| Template | 10/10. The first run was 8/10: AGENTS.md told agents to give a sibling package a `bundlers` entry without the runtime, which compiled it against the Kernel and loaded a second runtime in the page. The instructions now say to copy the application's entry unchanged |
| Command line acceptance | 48/48 against the toolchain that now installs the runtime |

In the template run, after two clicks an edit of `texts.ts` was requested through `/u/` by the open page: the next click drew `3 presses` on the same element, the page had one navigation entry and no navigation event, and the title, drawn once, changed only after a reload. That is an update applied by the runtime, not a reload.

## What remains

- The runtime is installed from its checkout under its provisional name and is published nowhere; its browser modules come from a stand-in origin in every run. No production build of it exists.
- A package that the CDN delivers still has unknown dependencies here: the `beyond-resolution/1` document has no route. The runtime's coordinator imports only its own `bundle`, so these runs did not need it.
- Widgets, styles as artifacts and declarations remain unproduced.
