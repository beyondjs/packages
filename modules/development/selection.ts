import { promises as fs } from 'fs';
import { join } from 'path';
import { Root } from './root';
import type { Log } from './log';
import type { IBuildable, IPublishedModule } from './builds';
import { DevelopmentError } from './error';

/**
 * The development selection as clients read and replace it
 */
export /*bundle*/ interface ISelection {
	/**
	 * Whether somebody selected. Until then every package of the workspace is in development, because a
	 * package that was never published has no other place to come from.
	 */
	explicit: boolean;
	packages: string[];
	modules: string[];

	/**
	 * Where a preview loads what the workspace does not develop and this environment can compile: from this
	 * environment (`environment`, the default) or from the CDN at the installed exact version (`cdn`)
	 */
	externals: 'environment' | 'cdn';

	/**
	 * Selected names that the workspace no longer declares. They select nothing and are kept, so that a
	 * package that comes back with a branch is still selected.
	 */
	unknown: string[];
}

/**
 * Which packages and public modules of the workspace are in development, which means that a preview loads
 * them from this environment while every other dependency comes from the CDN, and where a preview loads the
 * installed packages this environment could compile itself (`externals`).
 *
 * Only a request that replaces the selection changes it. Reading, opening, editing or building a file never
 * does. A replacement states the whole selection: what it does not name is not in development, and its
 * externals are `environment` unless it says `cdn`. It is state of the working copy, not source: it is kept
 * under the state directory of the served root, which is on the durable volume of a project environment, is
 * ignored by Git through its own ignore file, and is neither listed nor writable as a file of the contract.
 */
export /*bundle*/ class Selection {
	static FILE = 'development/selection.json';
	static EXTERNALS = ['environment', 'cdn'];

	#directory: string;
	#delivery: IBuildable;
	#log: Log;
	#stored: { packages: string[]; modules: string[]; externals: ISelection['externals'] };
	#loaded: Promise<void>;

	constructor(root: string, delivery: IBuildable, log: Log) {
		this.#directory = join(root, Root.STATE);
		this.#delivery = delivery;
		this.#log = log;
	}

	get #file() {
		return join(this.#directory, ...Selection.FILE.split('/'));
	}

	#names(value: unknown, field: string): string[] {
		const valid = value instanceof Array && value.every(one => typeof one === 'string' && one.length > 0);
		if (!valid) throw new DevelopmentError('SELECTION_INVALID', `"${field}" must be a list of names`, 400);
		return [...new Set(<string[]>value)].sort();
	}

	/**
	 * The externals a replacement names: `environment` when it names none
	 */
	#externals(value: unknown): ISelection['externals'] {
		if (value === void 0) return 'environment';
		if (Selection.EXTERNALS.includes(<string>value)) return <ISelection['externals']>value;
		throw new DevelopmentError('SELECTION_INVALID', `"externals" must be ${Selection.EXTERNALS.map(one => `"${one}"`).join(' or ')}`, 400);
	}

	async #load() {
		try {
			const { packages, modules, externals } = JSON.parse(await fs.readFile(this.#file, 'utf8'));
			this.#stored = { packages: this.#names(packages, 'packages'), modules: this.#names(modules, 'modules'), externals: this.#externals(externals) };
		} catch (error) {
			// A selection that cannot be read is not guessed: nobody selected
			this.#stored = void 0;
		}
	}

	async #published(): Promise<IPublishedModule[]> {
		await this.#delivery.refresh?.();
		return this.#delivery.published();
	}

	#specifier({ specifier, name, subpath }: IPublishedModule): string {
		return specifier ?? (subpath === '.' ? name : `${name}/${subpath.replace(/^\.\//, '')}`);
	}

	async read(): Promise<ISelection> {
		await (this.#loaded ??= this.#load());
		const published = await this.#published();
		const known = new Set(published.flatMap(module => [module.name, this.#specifier(module)]));

		if (!this.#stored) return { explicit: false, packages: [...new Set(published.map(({ name }) => name))].sort(), modules: [], externals: 'environment', unknown: [] };
		const { packages, modules, externals } = this.#stored;
		return { explicit: true, packages, modules, externals, unknown: [...packages, ...modules].filter(name => !known.has(name)) };
	}

	/**
	 * @returns Whether a selection that was read puts a public module of the workspace in development
	 */
	covers({ explicit, packages, modules }: ISelection, module: IPublishedModule): boolean {
		return !explicit || packages.includes(module.name) || modules.includes(this.#specifier(module));
	}

	/**
	 * Replaces the selection. Every name must be a package or a public module that the workspace declares, and
	 * `externals`, when given, `environment` or `cdn`.
	 */
	async replace(values: { packages?: unknown; modules?: unknown; externals?: unknown }): Promise<ISelection> {
		if (!values || typeof values !== 'object') throw new DevelopmentError('SELECTION_INVALID', 'The selection must be an object', 400);
		const packages = this.#names(values.packages ?? [], 'packages');
		const modules = this.#names(values.modules ?? [], 'modules');
		const externals = this.#externals(values.externals);

		const published = await this.#published();
		const unknown = [
			...packages.filter(name => !published.some(module => module.name === name)),
			...modules.filter(name => !published.some(module => this.#specifier(module) === name))
		];
		if (unknown.length) {
			const message = `The workspace declares no package or public module named ${unknown.map(name => `"${name}"`).join(', ')}`;
			throw new DevelopmentError('SELECTION_INVALID', message, 400, { unknown });
		}

		await this.#write(JSON.stringify({ packages, modules, externals }, null, '\t'));
		this.#stored = { packages, modules, externals };
		return this.#announce();
	}

	/**
	 * Forgets the selection, so every package of the workspace is in development again
	 */
	async clear(): Promise<ISelection> {
		await (this.#loaded ??= this.#load());
		await fs.rm(this.#file, { force: true });
		this.#stored = void 0;
		return this.#announce();
	}

	async #announce(): Promise<ISelection> {
		this.#loaded = Promise.resolve();
		const selection = await this.read();
		this.#log.append('selection.changed', { selection });
		return selection;
	}

	/**
	 * The state directory ignores itself, so a working copy never commits it whatever its own ignore rules are
	 */
	async #write(content: string) {
		const file = this.#file;
		await fs.mkdir(join(file, '..'), { recursive: true });
		await fs.writeFile(join(this.#directory, '.gitignore'), '*\n');

		const temporary = `${file}.${process.pid}.${Date.now()}`;
		await fs.writeFile(temporary, `${content}\n`);
		await fs.rename(temporary, file);
	}
}
