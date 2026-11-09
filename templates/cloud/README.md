# Cloud templates

The smallest packages a person can start from in the cloud and publish through Beyond CDN: each one checks clean in CDN's source check and is registered and prepared by CDN as it is written. They live here, beside the implementation CDN's check and preparation run, so they change with what that implementation accepts, and [the templates validation](../../tests/templates/README.md) fails when one stops checking or compiling clean.

Nothing in this directory is part of Packages: `beyond.json` names only the root package, whose modules are under `modules/`, and the manifest's `files` leaves `templates/` out of the npm archive.

## Who consumes it

Beyond Snapshots vendors a copy of this directory for its `create_source` tool, which writes a template's files as a new source, and tests its copy against this one. A consumer takes the files as they are; the only change it may make is the `name` member of `package.json`.

## The catalog, `beyond-cloud-templates/1`

[catalog.json](catalog.json):

| Member | Meaning |
| --- | --- |
| `protocol` | `beyond-cloud-templates/1` |
| `version` | The version of the catalog, exact semver, raised by the rule below |
| `templates[]` | One entry per template |

Each template:

| Member | Meaning |
| --- | --- |
| `name` | What a creator asks for (`frontend`, `react`) |
| `title` | A short description, sentence case |
| `kind`, `platform` | The CDN target it is published as: `frontend` on `web`, or `backend` on `node` |
| `form` | `module`: a Beyond package published as sources (`beyond.publication` `form: "source"`) whose public module is a directory with its `module.json`. `npm`: an ordinary npm package whose `exports` name its entry |
| `entry` | The public subpath the CDN target names: `main` for the module form, `.` for the npm form |
| `directory` | Its directory, beside this file |
| `package` | The package name its `package.json` carries, which a creator may replace |
| `files` | Every file of the template, relative to its directory, in the order of its digest; the directory holds nothing else |
| `digest` | `sha256:<hex>`, the digest of its files |

Every template's `package.json` has the exact version `0.1.0`.

## The digest

SHA-256 over the template's files in the order `files` lists them, each contributing its path, a line feed, its length in bytes in decimal, a line feed and its bytes, with nothing between files:

```text
<path>\n<byte length>\n<bytes><path>\n<byte length>\n<bytes>…
```

The path is the one `files` lists (forward slashes), the length counts bytes, not characters, and the files are read as they are, without changing line endings. The result is written `sha256:` followed by the lowercase hexadecimal digest. In Node:

```js
const hash = createHash('sha256');
for (const path of template.files) {
	const bytes = await readFile(join(directory, path));
	hash.update(`${path}\n${bytes.byteLength}\n`);
	hash.update(bytes);
}
const digest = `sha256:${hash.digest('hex')}`;
```

## Versioning

Any change to a template's files changes its digest, and every change raises the catalog `version`:

- **patch** for wording that changes no structure (a text the page shows, a title);
- **minor** for a new template;
- **major** for a removed template, or a changed entry, form, kind, platform or default package name.

A change records the new digest and version together; the validation fails on a digest that does not match.

## What each template publishes

| Template | CDN target | Files |
| --- | --- | --- |
| `frontend` | Package `page`, version `0.1.0`, entry `main`, platform `web`, kind `frontend` | `package.json` declares the `source` publication and the packaging bundler `@beyond-js/packages/bundlers/esbuild`; `main/module.json` publishes `main` for the web from `index.ts`, which adds a heading and a sentence to the page |
| `react` | Package `counter`, version `0.1.0`, entry `.`, platform `web`, kind `frontend` | `package.json` exports `./main.tsx` and depends on `react` and `react-dom` 19.1.0, with their types as development dependencies; `main.tsx` renders a counter button into the page |
| `backend` | Package `service`, version `0.1.0`, entry `.`, platform `node`, kind `backend` | `package.json` exports `./server.ts`, with `@types/node` 22.20.5 as a development dependency; `routes.ts` answers each request; `server.ts` serves once imported on `HOST` and `PORT`, answers `GET /health` with 200 and on `SIGTERM` accepts no new connection and exits within 10 s ([the backend profile](../../docs/backends.md)) |

The React template imports React as a namespace because the source check and the compilation use the classic JSX transform (`React.createElement`) when a package declares no TypeScript configuration.
