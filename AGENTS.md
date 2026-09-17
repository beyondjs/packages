# packages agent instructions

Canonical instructions for this repository and its descendants. Tool-specific files must only reference AGENTS.md. This is an independent Git repository; the current coordinated branch is `feature/next`.

Packages is a Beyond-authored packaging implementation. Read [development](docs/development.md), [architecture and SDK](docs/architecture.md) and [programming conventions](docs/programming.md) before changing its contracts. Engine compiles/serves the implementation as ESM for modern BEE Node execution; Packages itself must compile/serve the target widget app and shared module. Legacy-BEE fixtures do not select a different runtime. Preserve public/internal module boundaries and the runtime, types, styles and HMR acceptance criteria described locally.

- Use English for first-party docs, instructions, comments, docstrings and new explanatory text. Preserve intentional locale catalogs, public names/specifiers/paths, protocol keys and functional test values unless a compatibility change is explicitly authorized. Do not rewrite vendor, generated, lockfile or third-party content for language cleanup.
- Preserve current uncommitted work and repository history. Do not commit, push, reset, publish or deploy without explicit task authorization.
- Keep public Beyond module imports distinct from internal relative source imports. Do not silently replace the configured bootstrap, runtime or framework.
- Read the relevant maintained references before architectural changes; label source findings, runtime evidence and proposals accurately. Use targeted validation for behavior changes; documentation/comment edits do not require unrelated builds or services.
- Keep instructions concise here and link maintained documentation. Before editing nested areas, read any applicable nested AGENTS.md. Do not apply sibling repository instructions globally.

Documentation follows [the local documentation standards](docs/AGENTS.md).
