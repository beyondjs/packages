# Packages Dev Server and File API

Packages owns Dev Server/File API, reusing its existing compiler, dependency graphs, source discovery, watchers, artifacts and lifecycle. Workspace does not own a competing server implementation. This is approved ownership and required acceptance, not a claim that current interfaces are complete. Read [development](development.md), [architecture](architecture.md) and [programming conventions](programming.md) before changing public contracts. The part that exists, the [development service](service.md) under `service/`, covers context, discovery, lifecycle, artifact delivery, selection and state. The file operations, revisions, events, build correlation and delegated access described below are the public module `@beyond-js/packages/development`, which a host mounts on that service as an extension; the [development contract](development-contract.md) specifies them and lists the limits of the current implementation.

## Responsibilities

Provide file read/list/tree/create/edit/rename/delete; expected revisions/conflict results; detection of API and direct Codex/Git/tool disk changes; scoped realtime/events/reconnect/reconciliation; build/artifact/diagnostic delivery and development control. Preserve public bare references and distinct source-file, package/version and public-module graphs. Do not rename the technical Workspace/Project models.

Inspector is no longer an independent product component. Integrate required inspection/control capabilities here, retaining public module/protocol compatibility until explicit migration. Runtime applies HMR; neither successful builds nor event delivery prove replacement. Engine compiles Packages implementation ESM and modern BEE Node executes it; target apps must be compiled/served by Packages.

## Consumers and authority

Standalone CLI can run Packages against a local directory without Docker or Workspace UI. Workspace is a separate product owning frontend and a central administration API for users/teams/roles/permissions, project/resource catalog, Docker creation/start/placement/recovery and scoped access grants. That authority never belongs inside each project container.

Workspace project Docker installs Packages and pinned tools in local and cloud modes. Both modes use the same capability/API contract via infrastructure adapters. Packages validates delegated project/root/operation authorization and selected expiry/revocation rules without a parallel roles database. Grant format, transport and precise schemas need fixtures; Docker alone does not prove untrusted-code isolation.

CDN consumes the same packaging/artifact capabilities under immutable release/delivery policy. Do not make CDN production depend on a mutable working tree or live development environment. Template source/guidance/config may record compatibility but never copy this server or central administration implementation.

## Synchronization and durability contract

Define source revisions, expected-write checks, external-write race handling and multi-file visibility. API-only locks do not serialize tools writing directly to disk. Create/change/delete/rename must reconcile trees and existing Packages invalidation, not a second graph. Realtime is primary; polling/manual refresh must inspect authoritative state when watcher events are missed. Replay valid cursors or snapshot/rescan after gaps/restart; no lossless watcher guarantee.

Report file persistence, build completion/errors and preview/HMR state separately against identified inputs. Reject obsolete build results as current. Preserve unsaved editor buffers through explicit compare/conflicts on agent changes, deletion/rename and reconnect. Central environment orchestration must persist uncommitted/unpushed work and buffers beyond containers under explicit recovery policies; Packages exposes the required revision/state contract.

Saved, committed and pushed differ. GitHub restores pushed history only; it does not persist agent state, conversations or buffers automatically. Workspace supports user and Beyond-managed repositories plus later transfer preserving history/work. Exact credentials, branches, ownership/transfer and automatic commit/push policy remain open; this guide does not authorize repository creation or Git mutations.

## Acceptance and implementation boundaries

- Reproduce current packaging baseline before claiming repairs; validate actual public API/schema paths, artifact provenance and ready/error/stop outside fixed checkouts.
- Exercise read/list/tree/create/edit/rename/delete via API and direct agent/tools, same-file conflicts, dirty-buffer handling, build failure/recovery and stale result rejection.
- Exercise event duplicates/gaps, disconnect/reconnect, polling/manual refresh, rescan and cleanup. Verify runtime HMR separately.
- Reject unauthorized/revoked delegated access without adding project-container role authority. Prove matching local/cloud contract inside Workspace Docker and independent Docker-free standalone CLI consumption.
- With Workspace, test recovered pending source/buffers after container replacement, scoped routing and cloud parity. Full local product proof comes first, but cloud/administration are in Workspace v1.

Exact package exports, revision/event/delegation schemas and compatibility versions are engineering contracts to define from source and fixtures. The service implementation first written in the Workspace repository was relocated here in coordination with its consumers; do not move or delete other concurrent implementation based only on this document, and coordinate ownership and an explicit migration before such code changes. Documentation/source audit is not runtime validation.
