# Repository & Registry Settings System

This document explains **how we load, normalize, merge, and expose configuration** for NPM–style package repositories
and their registries from multiple sources:

1. Local `.npmrc` files (project, workspace, user, global)
2. Environment variables (CI / runtime overrides)
3. Remote Firestore document (centralized distribution)

It is written so that **someone with zero prior `.npmrc` knowledge** can understand the model.

---

## 1. Core Concepts

| Term           | Meaning                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| **Repository** | A logical package source (e.g. "npm", "internal", "github-pkg"). It _may_ expose a registry protocol.  |
| **Registry**   | An interface that can return: `versions(pkg)` and `spec(pkg, version)` (i.e. metadata & package JSON). |
| **Scope**      | A namespace prefix in package names: `@scope/name`. Scopes can map to different repositories/hosts.    |
| **Host**       | Network host part of a registry URL (e.g. `registry.npmjs.org`, `custom.repo.io`).                     |
| **Auth**       | Credentials attached either to a host (scoped or global) or implicitly to the _default repository_.    |
| **Default**    | The repository / host used for any package **without an explicit scope mapping**.                      |

---

## 2. Why a Unified Settings Loader?

Typical NPM-based projects rely on `.npmrc` only. Advanced, multi-environment or poly-repository systems need:

-   Deterministic merging (local vs CI overrides).
-   Centralized distribution of auth (Firestore / secrets backend).
-   Support for multiple repository types (npm, verdaccio, artifactory, custom).
-   Clean abstraction: **Repository** (logical) vs **Registry** (protocol) vs **Scope** (routing) vs **Auth**
    (credentials).

---

## 3. Data Model

### 3.1 Authentication Types

```ts
type RepositoryAuthMode = 'token' | 'basic' | 'user-pass';

interface RepositoryAuthType {
	mode: RepositoryAuthMode;
	token: string; // raw token, base64 (basic), password (user-pass), or auth token
	user?: string; // only for user-pass
	origin: OriginType;
}

type OriginType = 'project-rc' | 'workspace-rc' | 'user-rc' | 'global-rc' | 'ci' | 'cdn';
```

3.2 Aggregated Settings Shape (exposed by each loader)

interface IRepositorySettings { default: { host: string; auth?: RepositoryAuthType }; // default repository host scopes:
Map<string, string>; // scope (@scope) -> host hosts: Map<string, RepositoryAuthType>; // host -> auth }

Important: We intentionally separate: • scopes (routing) • hosts (auth map) • default (fallback host + optional auth)

⸻

4. Source Types

Source Purpose Priority (merge order)\* LocalLoader Reads .npmrc (project → workspace → user → global) Lowest (1)
EnvLoader CI / runtime overrides via process.env Middle (2) FirestoreLoader Central remote config (e.g.
organization-wide) Highest (3)

\*Higher priority overwrites lower priority where conflicts exist.

⸻

5. .npmrc Primer (for newcomers)

A .npmrc is a line-based config file. Examples:

# Set default registry

registry=https://registry.npmjs.org/

# Map a scope to a custom registry

@myorg:registry=https://custom.repo.io/

# Token auth for a host

//custom.repo.io/:\_authToken=abcdef123456

# Basic auth for default (base64 of user:pass)

\_auth=dXNlcjpwYXNz

# User/pass for host

//private.repo.io/:username=john //private.repo.io/:password=secr3t

# Default user/pass (applies to current default host)

username=ci-bot password=s3cr3t

5.1 Auth Placement Rules

Pattern Description Scope? Host? Default? @scope:registry=URL Scope routing ✅ — — registry=URL Default host override —
— ✅ //host/:\_authToken=TOKEN Token tied to specific host — ✅ (maybe, if host == default) \_auth=BASE64 Basic auth for
default — — ✅ \_authToken=TOKEN Token for default — — ✅ username=U + password=P User/pass for default — — ✅
//host/:username=U + //host/:password=P User/pass for host — ✅ (maybe)

⸻

6. Environment Variable Mapping

We define predictable variable names to avoid parsing .npmrc in CI:

Variable Meaning NPM*REGISTRY_DEFAULT Default registry URL (host derived) NPM_AUTH_TOKEN_DEFAULT Default token auth
NPM_AUTH_BASIC_DEFAULT Default basic auth (base64 user:pass) NPM_AUTH_USER_DEFAULT Default user (user-pass)
NPM_AUTH_PASS_DEFAULT Default pass (user-pass) NPM_SCOPE*<SCOPE>_REGISTRY Scope registry (e.g. NPM_SCOPE_MYORG_REGISTRY)
NPM_HOST_<HOST>_TOKEN Host token auth NPM_HOST_<HOST>_USER Host user (user-pass) NPM_HOST_<HOST>\_PASS Host pass
(user-pass)

Notes: • <SCOPE>: uppercase, omit @ (e.g. @myorg → MYORG). • <HOST>: sanitized host (no protocol), convert dots to
underscores only if your CI disallows dots; otherwise use raw host.

⸻

7. Firestore Schema

A Firestore document acts as a serialized superset of settings:

interface FirestoreNpmSettings { default: { host: string; auth?: { mode: 'token' | 'basic' | 'user-pass'; token: string;
user?: string; origin: 'ci' | 'cdn'; }; }; scopes: Record<string, string>; // "@myorg": "custom.repo.io" hosts:
Record<string, { mode: 'token' | 'basic' | 'user-pass'; token: string; user?: string; origin: 'ci' | 'cdn'; }>; }

Example:

{ "default": { "host": "registry.npmjs.org", "auth": { "mode": "token", "token": "abc123", "origin": "ci" } }, "scopes":
{ "@myorg": "custom.repo.io", "@another": "another.repo.io" }, "hosts": { "custom.repo.io": { "mode": "user-pass",
"token": "secret-password", "user": "deploy", "origin": "cdn" } } }

⸻

8. Loaders

8.1 LocalLoader

Parses .npmrc chain: Order (low → high priority inside LocalLoader): global → user → workspace → project

Outputs IRepositorySettings.

Key parsing steps: 1. Identify registry=... (default host) 2. Map @scope:registry=... (scope → host) 3. Gather auth
tokens / basic / user-pass (hosted or default)

8.2 EnvLoader • Builds default.host from NPM_REGISTRY_DEFAULT or fallback. • Sets default auth using priority:
user-pass > basic > token. • Iterates process.env for scope and host patterns.

8.3 FirestoreLoader • Fetches one document (already validated externally). • Transforms JSON keys into Maps (scopes,
hosts). • Overrides any previously loaded values.

⸻

9. Merge Strategy

Pseudo-sequence:

const local = await new LocalLoader().process(...); const env = await new EnvLoader().process(); const remote = await
new FirestoreLoader().process(docRef);

const merged: IRepositorySettings = mergeSettings(local, env, remote);

9.1 Conflict Rules

Element Merge Rule default.host Highest priority source wins. default.auth Replaced entirely by higher priority if
present. scopes Key-by-key override (higher priority overwrites same scope). hosts Key-by-key override (higher priority
overwrites same host).

⸻

10. Consuming the Settings

10.1 Resolve Host for a Package

function hostFor(pkg: string, settings: IRepositorySettings): string { if (pkg.startsWith('@')) { const scope =
pkg.split('/')[0]; const scoped = settings.scopes.get(scope); if (scoped) return scoped; } return settings.default.host;
}

10.2 Resolve Auth for a Host

function authFor(host: string, settings: IRepositorySettings): RepositoryAuthType | undefined { if (host ===
settings.default.host && settings.default.auth) return settings.default.auth; return settings.hosts.get(host); }

⸻

11. Example Walkthrough

Given:

Local .npmrc:

registry=https://registry.npmjs.org/ @team:registry=https://packages.internal.local/

Env vars:

NPM_SCOPE_TEAM_REGISTRY=https://mirror.internal.local/ NPM_HOST_mirror.internal.local_TOKEN=xyz
NPM_AUTH_TOKEN_DEFAULT=aaa

Firestore:

{ "scopes": { "@team": "secure.repo.local" }, "hosts": { "secure.repo.local": { "mode": "token", "token": "fireX",
"origin": "cdn" } } }

Resolution for @team/lib: 1. Local: @team → packages.internal.local 2. Env overrides: @team → mirror.internal.local 3.
Firestore overrides: @team → secure.repo.local (final)

Auth: • Firestore provides token for secure.repo.local → final auth: fireX.

⸻

12. Extension Points

Need Strategy Add new source (e.g. S3) Implement IRepositorySettings loader with process() returning the structure.
Inject repository type mapping Add a resolver that maps host → RepositoryType. Support encryption Decrypt tokens in
loader before populating hosts. Custom precedence Reorder loader invocation.

⸻

13. Edge Cases & Handling

Scenario Handling Multiple registry= lines Last one in highest-priority loader wins. Duplicate scope definitions Higher
priority loader overrides. Host auth conflict Higher priority overrides. Missing default registry Fallback to
registry.npmjs.org. Password containing = Regex split /=(.+)/ captures full right side. Empty \_authToken= Ignore / do
not set auth (optional validation).

⸻

14. Security Recommendations • Never log full tokens (log only hash or prefix). • Strip trailing slashes from URLs
    before storing hosts. • Validate that mode matches actual credential pattern. • Optionally add checksum of loaded
    config for audit.

⸻

15. Testing Strategy

Test What to Assert Parse simple .npmrc Default host + no auth. Scoped registry mapping scopes contains expected host.
Host token + default basic Both stored correctly. Env override of scope Scope host changed. Firestore final override
Highest priority applied. User/pass default default.auth.mode === 'user-pass'. User/pass host Entry in hosts map with
mode user-pass. Merge precedence Firestore > Env > Local.

⸻

16. Regex Reference

Purpose Pattern Scope registry ^(@[^:]+):registry=(.+)$
Default registry	^registry=(.+)$ Host token
^\/\/([^/]+)\/?:\_authToken=(.+)$
Default token	^_authToken=(.+)$ Basic auth ^\_auth=(.+)$
Default username	^username=(.+)$
Default password ^password=(.+)$
Host username	^\/\/([^/]+)\/?:username=(.+)$ Host password lookup ^//HOST/:password=
(constructed)

⸻

17. Minimal Code Snippet (Load All)

async function loadAll(): Promise<IRepositorySettings> { const local = new LocalLoader(); await
local.process(process.cwd());

    const env = new EnvLoader();
    await env.process();

    const remote = new FirestoreLoader();
    await remote.process(/* docRef or id */);

    return mergeSettings(local, env, remote);

}

⸻

18. Summary

The system produces a unified, explicit, minimal surface: • default.host (+ optional default.auth) • scopes: Map<scope,
host> • hosts: Map<host, auth>

Everything else (repository type inference, registry instantiation, scope routing, dependency resolution) builds on top
of this consistent foundation.
