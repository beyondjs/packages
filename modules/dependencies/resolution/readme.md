# Resolution Structure for Dependency Tarball Access

Each example shows a dependency entry from `package.json` and how it is resolved into a structured object. This object
is then used by the `registries` module to construct the tarball URL and associated headers to download the package.

---

## Semver from Default Registry

```json
{
	"lodash": "^4.17.0"
}
```

**Resolution**

```json
{
	"name": "lodash",
	"version": "^4.17.0",
	"resolution": "semver",
	"semver": "^4.17.0",
	"repository": "default"
}
```

**Tarball URL Construction**

The registries module uses the default registry (configured via .npmrc, e.g., https://registry.npmjs.org) and fetches
${registry}/lodash. It extracts the tarball from dist.tarball of the resolved version metadata.

⸻

## Scoped Semver from Default Registry

```json
{
	"@beyond-js/http": "^1.2.3"
}
```

**Resolution**

```json
{
	"name": "http",
	"scope": "beyond-js",
	"version": "^1.2.3",
	"resolution": "semver",
	"semver": "^1.2.3",
	"repository": "default"
}
```

**Tarball URL Construction**

The registries module checks .npmrc for a scoped registry under @beyond-js. If none is defined, it uses the default
registry. The metadata is fetched from ${registry}/@beyond-js%2fhttp, and the tarball is extracted from the dist.tarball
field.

⸻

## Alias to Semver Package

```json
{
	"my-lodash": "npm:lodash@^4.17.0"
}
```

**Resolution**

```json
{
	"name": "my-lodash",
	"version": "npm:lodash@^4.17.0",
	"resolution": "semver",
	"semver": "^4.17.0",
	"repository": "default",
	"alias": "lodash"
}
```

**Tarball URL Construction**

The registries module uses the alias target lodash and proceeds as in the default semver case. It uses
${registry}/lodash to retrieve metadata and extract the tarball URL from dist.tarball.

⸻

## GitHub Shorthand

```json
{
	"my-lib": "github:user/my-lib"
}
```

**Resolution**

```json
{
	"name": "my-lib",
	"version": "github:user/my-lib",
	"resolution": "git",
	"repository": "github",
	"git": {
		"host": "github.com",
		"user": "user",
		"repo": "my-lib",
		"ref": "HEAD"
	}
}
```

**Tarball URL Construction**

The registries module builds: https://github.com/user/my-lib/archive/HEAD.tar.gz Using the git.host, git.user, git.repo,
and git.ref.

⸻

## Git+HTTPS (GitLab)

```json
{
	"internal-tool": "git+https://gitlab.com/acme/internal-tool.git#v1.2.0"
}
```

**Resolution**

```json
{
	"name": "internal-tool",
	"version": "git+https://gitlab.com/acme/internal-tool.git#v1.2.0",
	"resolution": "git",
	"repository": "gitlab",
	"git": {
		"host": "gitlab.com",
		"user": "acme",
		"repo": "internal-tool",
		"ref": "v1.2.0"
	}
}
```

**Tarball URL Construction**

The registries module builds: https://gitlab.com/acme/internal-tool/-/archive/v1.2.0/internal-tool-v1.2.0.tar.gz Using
git.host, git.user, git.repo, and git.ref.

⸻

## Git+SSH (GitHub)

```json
{
	"secret-tool": "git+ssh://git@github.com:org/secret-tool.git#release"
}
```

**Resolution**

```json
{
	"name": "secret-tool",
	"version": "git+ssh://git@github.com:org/secret-tool.git#release",
	"resolution": "git",
	"repository": "github",
	"git": {
		"host": "github.com",
		"user": "org",
		"repo": "secret-tool",
		"ref": "release"
	},
	"warnings": [
		"Dependency \"secret-tool\" uses git+ssh which may not work in CI environments without SSH credentials."
	]
}
```

**Tarball URL Construction**

The registries module builds: https://github.com/org/secret-tool/archive/release.tar.gz Using git.host, git.user,
git.repo, and git.ref.

⸻

## Remote Tarball

```json
{
	"analytics-core": "https://cdn.example.com/analytics-core-1.0.0.tgz"
}
```

**Resolution**

```json
{
	"name": "analytics-core",
	"version": "https://cdn.example.com/analytics-core-1.0.0.tgz",
	"resolution": "tarball",
	"url": "https://cdn.example.com/analytics-core-1.0.0.tgz"
}
```

**Tarball URL Construction**

The registries module will use the url property directly as the location to fetch the tarball. No transformation is
needed. Headers may still be applied depending on global or repository-specific configuration.
