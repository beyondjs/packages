# Packages Dev Server and File API

Packages owns Dev Server/File API, reusing its existing compiler, dependency graphs, source discovery, watchers, artifacts and lifecycle. Workspace does not own a competing server implementation. This is approved ownership and required acceptance, not a claim that current interfaces are complete. Read [development](development.md), [architecture](architecture.md) and [programming conventions](programming.md) before changing public contracts. The part that exists, the [development service](service.md) under `service/`, covers context, discovery, lifecycle, artifact delivery, selection and state. The file operations, revisions, events, build correlation and delegated access described below are the public module `@beyond-js/packages/development`, which a host mounts on that service as an extension; the [development contract](development-contract.md) specifies them and lists the limits of the current implementation.

## Responsibilities

Provide file read/list/tree/create/edit/rename/delete; expected revisions/conflict results; detection of API and direct Codex/Git/tool disk changes; scoped realtime/events/reconnect/reconciliation; build/artifact/diagnostic delivery and development control. Preserve public bare references and distinct source-file, package/version and public-module graphs. Do not rename the technical Workspace/Project models.

Inspector is no longer an independent product component. Integrate required inspection/control capabilities here, retaining public module/protocol compatibility until explicit migration. Runtime applies HMR; neither successful builds nor event delivery prove replacement. Engine compiles Packages implementation ESM and modern BEE Node executes it; target apps must be compiled/served by Packages.

## Consumers and authority

Standalone CLI can run Core against a local directory without Docker or a product UI. Packages UI inspects and controls Core, with no backend of its own. Conduict owns machines, repository copies and its supervisor; Accounts owns people and sign-in, Projects owns common project authorization and Packages enablement. Conduict runs the same service per authorized copy through `files/2`, `development/1` and `archive/1`; see [portable connections](portable.md) for standalone pairing and [the service](service.md) for its lifecycle.

Workspace 2026 remains a running migration source with its existing central administration and environment rules until coordinated transition. Its legacy environment grants do not define the target product architecture. Packages validates delegated root/operation authorization, expiry and revocation without a parallel roles database. Docker alone does not prove untrusted-code isolation.

CDN consumes the same packaging/artifact capabilities under immutable release/delivery policy. Do not make CDN production depend on a mutable working tree or live development environment. Template source/guidance/config may record compatibility but never copy this server or central administration implementation.

## Local storage

Saved files, manifests and uncommitted work remain in the selected working copy: Conduict owns its copy storage and recovery, while standalone CLI uses a local directory without requiring Docker. Packages UI has no product database. The former Workspace retains its own catalog and storage during migration.

In the traced service path, Packages graphs, file/event indexes and delivery output live in memory and rebuild locally; explicit artifact builds write their configured output. A local installation keeps durable state of its own: the committed lock (`beyond-lock.json`) and the machine-local execution projection (`.beyond/execution.json`) in the working copy, and the source store and metadata cache, shared by every workspace of the user, in the user's cache directory ([local installation](local-installation.md#store-metadata-and-settings)). SQLite is permitted for local development cache, but the optional persistence source was not proved initialized by the current service/bootstrap/Workspace/Delivery path. Project files and development caches remain local rather than becoming Supabase data. Preserve this storage model in local and cloud Workspace environments.

## Synchronization and durability contract

Define source revisions, expected-write checks, external-write race handling and multi-file visibility. API-only locks do not serialize tools writing directly to disk. Create/change/delete/rename must reconcile trees and existing Packages invalidation, not a second graph. Realtime is primary; polling/manual refresh must inspect authoritative state when watcher events are missed. Replay valid cursors or snapshot/rescan after gaps/restart; no lossless watcher guarantee.

Report file persistence, build completion/errors and preview/HMR state separately against identified inputs. Reject obsolete build results as current. Preserve unsaved editor buffers through explicit compare/conflicts on agent changes, deletion/rename and reconnect. The host of a working copy must persist uncommitted/unpushed work and buffers beyond containers under explicit recovery policies; Packages exposes the required revision/state contract.

Saved, committed and pushed differ. GitHub restores pushed history only; it does not persist agent state, conversations or buffers automatically. Conduict owns repository copies and their history; Workspace's existing repositories and work require preservation through migration. Exact credentials, branches, ownership/transfer and automatic commit/push policy remain open; this guide does not authorize repository creation or Git mutations.

## Acceptance and implementation boundaries

- Reproduce current packaging baseline before claiming repairs; validate actual public API/schema paths, artifact provenance and ready/error/stop outside fixed checkouts.
- Exercise read/list/tree/create/edit/rename/delete via API and direct agent/tools, same-file conflicts, dirty-buffer handling, build failure/recovery and stale result rejection.
- Exercise event duplicates/gaps, disconnect/reconnect, polling/manual refresh, rescan and cleanup. Verify runtime HMR separately.
- Reject unauthorized/revoked delegated access without adding project-container role authority. Prove the per-copy contract inside Conduict Docker and independent Docker-free standalone CLI consumption.
- Test recovery of pending sources and buffers after machine replacement, scoped routing and cloud parity with Conduict; preserve the former Workspace's recovery obligations through migration.

Exact package exports, revision/event/delegation schemas and compatibility versions are engineering contracts to define from source and fixtures. The service implementation first written in the Workspace repository was relocated here in coordination with its consumers; do not move or delete other concurrent implementation based only on this document, and coordinate ownership and an explicit migration before such code changes. Documentation/source audit is not runtime validation.
