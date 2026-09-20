# Semantic TypeScript diagnostics

`@beyond-js/packages/diagnostics` type-checks one public module with a real TypeScript program and returns what the type checker finds as plain data. It is the capability the [CDN contract](cdn-contract.md#generation-publication-and-diagnostics) requires for premium jobs, and it is separate from generation.

Generation transforms each source on its own with `ts.transpileModule`, which reports what does not parse and nothing else. A value of the wrong type, or a call that does not match a signature declared in another file, compiles and is delivered. Those problems need the whole program of the module and the types of its dependencies, which is what this module builds. It emits no code, writes nothing, and never decides whether a module builds.

## Responsibilities

| Concern | Owner |
| --- | --- |
| Essential build errors (`TRANSPILE_ERROR`, unsatisfied dependencies, missing conditionals) | Generation. They are returned by every build, whoever requests it, and do not depend on this module. |
| Semantic diagnostics with file, range and compiler code, bounded and measured | This module. |
| Who may request a check, what it costs, where it runs and when it is killed | The CDN. |

Packages supplies the capability; it holds no entitlement, account or price. The CDN is expected to run a check only for a job entitled to it, inside the same isolated, killable unit child it uses for every Packages operation, with `limits` taken from its own configuration and its hard deadline as the last resort. It accounts `measured` to the job. A job without the entitlement still receives the essential errors of generation, so a module that does not build is never hidden behind the premium capability, and a check is never required to publish.

## API

```ts
import { Diagnostics } from '@beyond-js/packages/diagnostics';

const result = await Diagnostics.check({
	module: { package: '@suite/app', version: '0.1.0', root, subpath: './main', entry: 'main/index.ts' },
	conditions: { platform: 'node' },
	dependencies: { packages: { '@suite/shared': shared } },
	limits: { ms: 30000, files: 1000 },
	signal
});
```

`Diagnostics.check(request)` never throws and never names a location of the host. `Diagnostics.module(pkg, subpath)` describes a module of a live workspace `Package` as the `module` value below, or returns undefined when the package does not publish that subpath from sources; a caller without a workspace writes the same plain data itself.

### Request

| Member | Meaning |
| --- | --- |
| `module.package`, `module.version` | The package that publishes the module. The name also resolves imports of the package's own public specifiers. |
| `module.root` | The absolute directory of the package: a workspace package or an extracted npm package of Beyond sources. It is the only absolute value of the description and is never reported. |
| `module.subpath`, `module.entry` | The published subpath, such as `./main`, and its entry point relative to the package, such as `main/index.ts`. |
| `module.path` | The module directory relative to the package. Defaults to the directory of the entry point. |
| `module.files` | The sources relative to the package. Defaults to every `.ts` and `.tsx` file under the module directory, which is what generation compiles; `node_modules`, `builds` and dot directories are skipped. |
| `module.tsconfig` | A configuration file relative to the package, or `{ compilerOptions }` inline. Defaults to the `tsconfig.json` of the module directory, then the one of the package. |
| `sources.files` | Contents in memory, keyed by path relative to the package. They take precedence over the package directory. |
| `conditions` | `platform` and optional `environment`. They select the conditions of package `exports` when the types of a dependency are resolved (`web` is read as `browser`). |
| `dependencies.declarations` | Bare specifier → absolute declaration file or source entry point. Only that file becomes readable, so it must be self-contained; use `packages` for a dependency whose types span several files. |
| `dependencies.packages` | Package name → absolute package directory, which is how a store of extracted packages is laid out. The file is selected from the manifest: the `exports` entry of the subpath (the `types` condition, the requested conditions, `import`, `module`, `default`; single `*` patterns), a declaration or source next to a JavaScript target, then `types`, `typings` and `main`. A package of Beyond sources is typed by its source entry point. |
| `dependencies.roots` | Absolute directories laid out as `node_modules`. `@types/<name>` counterparts are looked up in them. |
| `limits` | `ms` (default 60000), `files` (default 2000, not counting the TypeScript default libraries) and `diagnostics` (default 500 returned; all are counted). |
| `signal` | Anything with an `aborted` member, such as an `AbortSignal`. |

Packages of global types supplied in `dependencies.packages`, such as `@types/node`, are included in the program. The `node_modules` directory of the package itself is always readable.

### Compiler options

The strictness is the one the module declares. Only a module with no configuration is checked with `strict`. The other defaults, which a configuration overrides, are `target: ES2022`, `module: ESNext`, `moduleResolution: bundler` when the module kind allows it, `isolatedModules`, `skipLibCheck` and `jsx: react`; the default libraries are those of the target. Whatever the configuration says, `noEmit` is set, the options that concern emitted files are removed, `typeRoots` is limited to the supplied locations, and `include`, `files` and `exclude` are ignored because the inputs are the sources of the module.

### Result

```ts
{
	complete: boolean,
	outcome?: { code, message, limit? },
	diagnostics: [{ category, code, severity, message, file?, range?, origin?, specifier?, occurrences? }],
	summary: { errors, warnings, unresolved, withheld, truncated },
	measured: { ms, files, program: { typescript, configuration, strict, sources, dependencies, libraries, phases } }
}
```

`file` is relative to the package and uses forward slashes. `range` holds zero-based `line` and `character` positions, as editors exchange them. A diagnostic of the configuration as a whole has neither. Only the sources of the module are checked and reported: a dependency is read for its types, and its own problems belong to its own check.

| Category | Meaning | Severity |
| --- | --- | --- |
| `semantic` | What the type checker reports, such as `TS2322` or `TS2345`. | As the compiler reports it. |
| `syntactic` | What does not parse. Generation reports the same problem as `TRANSPILE_ERROR`. | `error` |
| `options` | A problem of the configuration, such as an `extends` that is not found. | As the compiler reports it. |
| `types-unresolved` | The types of a bare public dependency, of a package of global types, of a platform global or of the JSX runtime were not found. The code is `TYPES_UNRESOLVED`, `origin` is the compiler code (`TS2307`, `TS2792`, `TS7016`, `TS2688`, `TS2580`, `TS2591`, `TS2582`, `TS2593`, `TS2584`, `TS2867`, `TS2868`, `TS7026`, `TS2875`) and `specifier` names the dependency. | `warning` |

Missing types are not errors of the module. Each dependency or global is reported once, at its first location, with its `occurrences`, and `summary.unresolved` lists the specifiers. What is imported without types is `any`, so it hides errors but does not produce false ones, with one exception: an implicit `any` (`TS7005`, `TS7006`, `TS7008`, `TS7010`, `TS7011`, `TS7018`, `TS7019`, `TS7031`, `TS7034`) can be a consequence of it, as in the parameter of a callback given to an untyped value. While any types are unresolved those reports are left out and counted in `summary.withheld`; once the types are supplied they are reported as errors. A relative import that is not found stays a `semantic` error, because it is a missing source of the module.

### Outcomes

`complete` is true only when every source was checked. Otherwise `outcome` explains why, and `diagnostics` holds what was obtained until then.

| Code | When |
| --- | --- |
| `DIAGNOSTICS_LIMIT_EXCEEDED` | `limit` is `files` or `ms`. The file limit acts while sources are found and while the program loads files. The time limit acts when the compiler requests a file, between two sources, and inside the type checker through its cancellation token. |
| `DIAGNOSTICS_CANCELLED` | `signal.aborted` became true. The compiler is synchronous, so a cancellation requested from the event loop is seen between two sources. |
| `DIAGNOSTICS_INPUT_INVALID` | The request does not describe a module: a missing member, a root that is not absolute, or an entry point or source outside the package. |
| `DIAGNOSTICS_FAILED` | The compiler failed unexpectedly. The message carries no host location. |

## Containment

A check reads the package directory, the supplied dependency locations and the TypeScript default libraries. Any other location does not exist for the compiler, so an import such as `../../outside` is a missing source and its content is never loaded. Reported files are relative to the package; messages that quote a file are rewritten with the package-relative path or with the labels `<dependencies>`, `<declarations>`, `<typescript>` and `<host>`.

## Validation

[`tests/cdn-diagnostics`](../tests/cdn-diagnostics/README.md) runs the capability under BEE Node on temporary packages, from the Packages directory:

```sh
BEE_URL=http://localhost:1112 WATCHERS_URL=http://localhost:1120 \
  node --import "$BEE_NODE_DIR/register.mjs" tests/cdn-diagnostics/index.mjs
```

It compares `ts.transpileModule` and `Delivery.module()` with the check on the same sources, and covers dependency types, unresolved types, limits, cancellation, invalid requests, measurement and host disclosure.

## Limitations

- The check has not been run inside the CDN unit child, and no entitlement or accounting exists in Packages. Integration with the CDN worker is not validated here.
- Generation does not call this module, and bundlers do not expose it per module. It is a separate public module that a job calls explicitly.
- Packages does not generate declarations. A dependency authored as Beyond sources is typed by its sources, which the program then loads; a dependency published only as JavaScript without declarations is `types-unresolved`.
- `typesVersions`, `imports` (`#` specifiers), nested `exports` patterns beyond a single `*`, and project references are not read. Imports the supplied locations do not type fall back to the resolution of the compiler, limited to the readable locations.
- Only TypeScript sources are checked. Svelte, Vue, SCSS and other processors have no semantic check.
- A program is created per call and nothing is kept between calls except the parsed default libraries of the process. Modules of Packages itself resolve their sibling public modules as `types-unresolved`, because this implementation is authored with export markers and has no declarations.
- The time limit is cooperative. A single pathological type instantiation can outlive it until the checker next polls the token, which is why the CDN hard deadline remains necessary.
