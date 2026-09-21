import type { IProcessorDiagnostic } from '@beyond-js/packages/sdk';
import type { ICompiledStyle } from './sass';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import { promises as fs, existsSync, statSync } from 'fs';
import { dirname, isAbsolute, join, relative, resolve } from 'path';

/**
 * How a module declares what Tailwind may scan, in its manifest:
 *
 * ```json
 * { "tailwind": { "sources": ["view.tsx", "parts"] } }
 * ```
 *
 * `sources` are files and directories relative to the module directory. Nothing outside the module is
 * scanned, and nothing is scanned when the manifest declares no sources: a stylesheet that imports
 * Tailwind then produces its theme and its own rules, and no utility.
 */
export interface ITailwindSettings {
	sources?: string[];
}

const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.vue', '.svelte', '.html', '.md', '.txt'];

/**
 * Compiles one stylesheet that imports Tailwind, with the pinned Tailwind this package installs.
 *
 * Tailwind emits the utilities of the class names it finds in the sources it is given. Here those sources
 * are only the ones the module declares, which keeps the stylesheet of a public module a function of that
 * module: adding a class to a declared source adds its utility, removing the last use removes it, and the
 * stylesheet of another module never changes. Automatic detection from the working directory is turned
 * off (`source(none)`) whatever the stylesheet says, because it would scan the whole project.
 *
 * The compiler is created for every build, never retained between them: a retained compiler accumulates
 * candidates and cannot forget a class that no source uses any more. Every file it reads (the stylesheet
 * itself, `tailwindcss`, a theme it imports, a plugin or a configuration, the scanned sources) is reported,
 * so the processor watches all of them.
 */
export class Tailwind {
	/**
	 * Whether a stylesheet uses Tailwind: it imports it, or uses its at-rules
	 */
	static uses(content: string): boolean {
		return /@import\s+(["'])tailwindcss(\/[^"']*)?\1|@tailwind\b|@theme\b|@source\b|@utility\b|@variant\b|@plugin\b|@config\b/.test(content);
	}

	#module: string;
	#package: string;

	/**
	 * @param module The module directory
	 * @param pkg The package directory, which a stylesheet or a plugin may be resolved from
	 */
	constructor(module: string, pkg: string) {
		this.#module = module;
		this.#package = pkg;
	}

	#inside(file: string): boolean {
		const path = relative(this.#module, file);
		return !!path && !path.startsWith('..') && !isAbsolute(path) || path === '';
	}

	/**
	 * The files of the declared sources, each with the extension the scanner keys its extractors by
	 */
	async #sources(declared: string[] | undefined, read: Set<string>, diagnostics: IProcessorDiagnostic[]) {
		const files: { file: string; extension: string }[] = [];
		const visit = async (path: string) => {
			const stats = statSync(path, { throwIfNoEntry: false });
			if (!stats) return void diagnostics.push({ code: 'TAILWIND_SOURCE_MISSING', message: `The Tailwind source "${relative(this.#module, path)}" does not exist` });
			if (stats.isDirectory()) {
				for (const entry of (await fs.readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
					if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
					await visit(join(path, entry.name));
				}
				return;
			}
			const extension = path.slice(path.lastIndexOf('.'));
			if (!EXTENSIONS.includes(extension) || path.endsWith('.d.ts')) return;
			files.push({ file: path, extension: extension.slice(1) });
			read.add(path);
		};

		for (const source of declared ?? []) {
			const path = resolve(this.#module, source);
			if (!this.#inside(path)) {
				diagnostics.push({ code: 'TAILWIND_SOURCE_OUTSIDE_MODULE', message: `The Tailwind source "${source}" is outside the module directory` });
				continue;
			}
			await visit(path);
		}
		return files;
	}

	/**
	 * Resolves a stylesheet id as Tailwind asks: a relative path from the importing base, or a stylesheet of
	 * an installed package (`tailwindcss`, `tailwindcss/theme.css`, the `index.css` of a plugin) resolved
	 * from the package of the module first, then from this implementation, which installs Tailwind itself
	 */
	#stylesheet(id: string, base: string): string | undefined {
		if (id.startsWith('.') || isAbsolute(id)) {
			const file = resolve(base, id);
			return existsSync(file) ? file : void 0;
		}

		const segments = id.split('/');
		const name = segments.splice(0, id.startsWith('@') ? 2 : 1).join('/');
		const subpath = segments.join('/');
		// This implementation runs from a directory whose installed packages include Tailwind: the one Packages
		// was started from, which in an installation is the toolchain
		for (const from of [pathToFileURL(join(this.#package, 'noop.js')).href, pathToFileURL(join(process.cwd(), 'noop.js')).href]) {
			try {
				const root = dirname(createRequire(from).resolve(`${name}/package.json`));
				const file = join(root, subpath || 'index.css');
				if (existsSync(file)) return file;
			} catch {
				// Not installed there, or its manifest is not exported: the next location is tried
			}
		}
	}

	async compile(file: string, content: string, settings: ITailwindSettings, relativeName: string): Promise<ICompiledStyle> {
		const read = new Set<string>();
		const diagnostics: IProcessorDiagnostic[] = [];
		const files = await this.#sources(settings?.sources, read, diagnostics);
		if (diagnostics.length) return { read: [...read], diagnostics };

		try {
			const { compile } = await import('tailwindcss');
			const { Scanner } = await import('@tailwindcss/oxide');

			// Automatic detection is disabled: only the declared sources are scanned
			const css = content.replace(/@import\s+(["'])tailwindcss\1\s*;/g, '@import "tailwindcss" source(none);');
			const compiler = await compile(css, {
				base: this.#module,
				from: file,
				loadStylesheet: async (id, base) => {
					const path = this.#stylesheet(id, base);
					if (!path) throw new Error(`The stylesheet "${id}" cannot be resolved from "${base}"`);
					read.add(path);
					return { path, base: dirname(path), content: await fs.readFile(path, 'utf8') };
				},
				loadModule: async (id, base) => {
					const require = createRequire(join(base, 'noop.js'));
					const path = require.resolve(id, { paths: [base, this.#package] });
					read.add(path);
					const imported = await import(pathToFileURL(path).href);
					return { path, base: dirname(path), module: imported.default ?? imported };
				}
			});

			const scanner = new Scanner({ sources: [] });
			const candidates = new Set<string>();
			for (const { file: source, extension } of files) {
				const text = await fs.readFile(source, 'utf8');
				scanner.getCandidatesWithPositions({ content: text, extension }).forEach(({ candidate }) => candidates.add(candidate));
			}
			const code = compiler.build([...candidates].sort());
			const map = Tailwind.#map(<IDecodedMap>(<unknown>compiler.buildSourceMap()), file, relativeName);
			read.delete(file);
			return { code, map, read: [...read], diagnostics };
		} catch (error) {
			read.delete(file);
			return { read: [...read], diagnostics: [{ code: 'TAILWIND_ERROR', message: error.message }] };
		}
	}

	/**
	 * A source map from the decoded mappings Tailwind reports. The stylesheet of the module is named as the
	 * artifact names it; the stylesheets Tailwind loaded (its own, a theme) are named by their location.
	 */
	static #map(decoded: IDecodedMap, file: string, name: string): string | undefined {
		if (!decoded?.mappings?.length) return;

		const sources: string[] = [];
		const index = (url: string) => {
			const source = url === file || url === pathToFileURL(file).href ? name : url;
			let position = sources.indexOf(source);
			position === -1 && (position = sources.push(source) - 1);
			return position;
		};

		const encode = (value: number): string => {
			const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
			let vlq = value < 0 ? (-value << 1) | 1 : value << 1;
			let out = '';
			do {
				let digit = vlq & 31;
				vlq >>>= 5;
				vlq > 0 && (digit |= 32);
				out += chars[digit];
			} while (vlq > 0);
			return out;
		};

		const lines: string[][] = [];
		const last: number[] = [];
		let previous = { source: 0, line: 0, column: 0 };
		const sorted = [...decoded.mappings].sort((a, b) => a.generatedPosition.line - b.generatedPosition.line || a.generatedPosition.column - b.generatedPosition.column);
		// Lines are one-based and columns zero-based in the decoded map; anything outside that is dropped
		for (const { originalPosition, generatedPosition } of sorted) {
			if (!originalPosition?.source?.url) continue;
			const line = generatedPosition.line - 1;
			const column = generatedPosition.column;
			const original = { line: originalPosition.line - 1, column: originalPosition.column };
			if ([line, column, original.line, original.column].some(value => !(value >= 0))) continue;
			while (lines.length <= line) lines.push([]);
			const source = index(originalPosition.source.url);
			const segment = encode(column - (last[line] ?? 0)) + encode(source - previous.source) + encode(original.line - previous.line) + encode(original.column - previous.column);
			lines[line].push(segment);
			last[line] = column;
			previous = { source, line: original.line, column: original.column };
		}
		return JSON.stringify({ version: 3, sources, names: [], mappings: lines.map(line => line.join(',')).join(';') });
	}
}

/**
 * The decoded map Tailwind builds: positions are one-based
 */
interface IDecodedMap {
	sources: { url: string; content: string }[];
	mappings: {
		originalPosition?: { source: { url: string }; line: number; column: number };
		generatedPosition: { line: number; column: number };
	}[];
}
