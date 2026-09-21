import type { IProcessorDiagnostic } from '@beyond-js/packages/sdk';
import { compileString, type FileImporter } from 'sass';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, resolve } from 'path';
import { existsSync } from 'fs';

export interface ICompiledStyle {
	code?: string;
	map?: string;

	/**
	 * The files the compilation read besides the source, as absolute paths
	 */
	read: string[];
	diagnostics: IProcessorDiagnostic[];
}

/**
 * Compiles one CSS or SCSS source of a module with Sass, the pinned version this package installs.
 *
 * A `.scss` file is compiled as SCSS; a `.css` file is compiled as plain CSS, which Sass passes through
 * while still resolving its relative `@import`s and reporting its syntax errors. Relative imports resolve
 * against the importing file, so a partial in the module directory or a theme elsewhere in the package
 * becomes a dependency of the module, which the processor watches. The `url()` references are left as
 * written: a stylesheet is delivered beside its module, and a path relative to the source stays valid when
 * the asset is declared and served with the package.
 */
export class Sass {
	/**
	 * Files that start with an underscore are partials: they are included by other sources and produce no
	 * stylesheet of their own
	 */
	static partial(file: string): boolean {
		return /(^|[\\/])_[^\\/]*$/.test(file);
	}

	static compile(file: string, content: string, relative: string): ICompiledStyle {
		const read = new Set<string>();
		const importer: FileImporter<'sync'> = {
			findFileUrl(url) {
				if (/^[a-z][a-z0-9+.-]*:/i.test(url) && !url.startsWith('file:')) return null;
				const base = dirname(file);
				const candidate = resolve(base, url.startsWith('file:') ? fileURLToPath(url) : url);
				// Sass tries the extensions and the partial prefix itself from the returned location
				return pathToFileURL(candidate);
			}
		};

		try {
			const syntax = file.endsWith('.scss') ? 'scss' : file.endsWith('.sass') ? 'indented' : 'css';
			const result = compileString(content, {
				syntax,
				url: pathToFileURL(file),
				sourceMap: true,
				sourceMapIncludeSources: false,
				importers: [importer],
				loadPaths: [dirname(file)],
				quietDeps: true
			});

			result.loadedUrls.forEach(loaded => loaded.protocol === 'file:' && read.add(fileURLToPath(loaded)));
			read.delete(file);

			const map = result.sourceMap;
			if (map) {
				// The map names the sources as the artifact does: relative to the module directory
				map.sources = map.sources.map(source => {
					try {
						const path = source.startsWith('file:') ? fileURLToPath(source) : source;
						return path === file ? relative : path;
					} catch {
						return source;
					}
				});
			}
			return { code: result.css, map: map && JSON.stringify(map), read: [...read], diagnostics: [] };
		} catch (error) {
			const span = error.span;
			const position = span ? { line: (span.start?.line ?? 0) + 1, column: (span.start?.column ?? 0) + 1 } : void 0;
			const message = error.sassMessage ?? error.message;
			return { read: [...read], diagnostics: [{ code: 'STYLE_ERROR', message, position }] };
		}
	}

	/**
	 * Whether a file exists, which Sass asks through its own resolution
	 */
	static exists(file: string): boolean {
		return existsSync(file);
	}
}
