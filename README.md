# @beyond-js/packages

Packages is the Beyond packaging implementation written in Beyond. It models workspaces, packages, public modules, bundlers, conditional outputs and processors. Packages also owns Dev Server/File API, consumed by standalone CLI and Workspace; the independent CDN consumes shared compiler/artifact capabilities. Workspace central administration owns teams/permissions/resources and Docker lifecycle, never delegated to per-project role databases.

The existing Engine generation compiles Packages implementation modules; modern BEE Node loads their ECMAScript output. Packages then compiles the target packages itself: it discovers their public modules, selects their bundler and conditions, and assembles executable artifacts that keep their public references and can be updated one source file at a time. HTTP delivery, widgets, styles, declarations and the complete update loop still require integration.

- [Development service](docs/service.md): the Dev Server implementation under `service/`, its clients, lifecycle and embedding options, the transitional [bootstrap package](bootstrap/README.md), and what exists and remains for an Engine-independent distribution.
- [Dev Server/File API ownership and acceptance](docs/development-server.md): source synchronization, delegated authorization and local/cloud consumer boundaries.
- [Development contract `beyond-dev-files/1`](docs/development-contract.md): source revisions, conflicts, ordered events with replay and resync, build correlation, delegated access and legacy inspector compatibility, with schema, fixtures and behavior scenarios under `contracts/development`. Implemented by the public module `@beyond-js/packages/development` and validated by `tests/development`.
- [Development and acceptance](docs/development.md): execution roles, configuration, current blockers and the functional widget development loop.
- [Architecture and bundlers SDK](docs/architecture.md): actual public extension interfaces, source/output flow, artifacts, diagnostics and lifecycle.
- [Programming conventions](docs/programming.md): Beyond authoring, public versus internal modules, naming, state and tests.
- [Coding standards](docs/coding-standards.md): binding file-length, object-oriented design and naming rules.
- [First-stage validation](tests/stage-1/README.md): two packages compiled, executed and updated, with the commands to reproduce it.

The manifest supplies Beyond build/distribution configuration, not a standalone npm start command. Begin with the development guide before running historical fixtures or changing public interfaces.
