# packages agent instructions

Canonical instructions for this repository and its descendants. Tool-specific files must only reference AGENTS.md. This is an independent Git repository; the current coordinated branch is `feature/next`.

Evolving Packages implementation, based on dev. Keep new Workspace/SDK contracts distinct from the Engine bootstrap. Read the repository [development guide](docs/development.md), then the [testbed implementation brief and decision register](../docs/testbed-plan.md) and [reported runtime audit](../docs/test-workspace.md) before planning work. The objective is a real widget app and independent shared module compiled/served by Packages; Engine compiles/serves the implementation as ESM for modern BEE Node execution and remains a bootstrap/HMR reference; its process may stay alive while Packages serves the target app. Existing legacy-BEE fixture behavior is historical evidence, not a different selected runtime. Preserve settled module/runtime/type/style boundaries, and distinguish unapproved compatibility proposals from routine fixes.

- Use English for first-party docs, instructions, comments, docstrings and new explanatory text. Preserve intentional locale catalogs, public names/specifiers/paths, protocol keys and functional test values unless a compatibility change is explicitly authorized. Do not rewrite vendor, generated, lockfile or third-party content for language cleanup.
- Preserve current uncommitted work and repository history. Do not commit, push, reset, publish or deploy without explicit task authorization.
- Keep public Beyond module imports distinct from internal relative source imports. Do not silently replace the configured bootstrap, runtime or framework.
- Read the relevant maintained references before architectural changes; label source findings, runtime evidence and proposals accurately. Use targeted validation for behavior changes; documentation/comment edits do not require unrelated builds or services.
- Keep instructions concise here and link maintained documentation. Before editing nested areas, read any applicable nested AGENTS.md. Do not apply sibling repository instructions globally.

Suite references: [packages.md](../docs/packages.md), [workspaces.md](../docs/workspaces.md), [bundlers-sdk.md](../docs/bundlers-sdk.md), [cdn-api.md](../docs/cdn-api.md), [packages-programming.md](../docs/packages-programming.md). These links use the beyond-suite checkout layout; if opened independently, inspect local source and do not invent missing suite documentation.
