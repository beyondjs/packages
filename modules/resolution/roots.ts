import type { IProject, IProjectDependencies } from '@beyond-js/packages/project/types';
import type { IPackageProviders } from '@beyond-js/packages/providers/types';
import type { IPackageDependencies } from '@beyond-js/packages/types';
import type { IRoot, IGraphDiagnostic } from './types';

export type RootType = Required<Omit<IRoot, 'targets'>> & { targets?: string[] };

const groups = {
	main: 'dependencies',
	development: 'devDependencies',
	peer: 'peerDependencies',
	optional: 'optionalDependencies'
} as const;

/**
 * The requirements of an application presented as the project the dependency graph resolves. It has no
 * manifest on disk: the roots are what a registered application declares.
 */
export class Roots implements IProject {
	readonly name = 'beyond-roots';
	readonly version = '0.0.0';
	readonly processed = true;
	readonly ready = Promise.resolve();

	#packages: IPackageProviders;
	get packages() {
		return this.#packages;
	}

	#list: RootType[] = [];
	/**
	 * The roots in canonical order
	 */
	get list() {
		return this.#list;
	}

	#diagnostics: IGraphDiagnostic[] = [];
	get diagnostics() {
		return this.#diagnostics;
	}

	#dependencies: IProjectDependencies;
	get dependencies() {
		return this.#dependencies;
	}

	constructor(roots: IRoot[] | Record<string, string>, packages: IPackageProviders) {
		this.#packages = packages;

		const declared: IRoot[] = Array.isArray(roots)
			? roots
			: Object.entries(roots || {}).map(([name, range]) => ({ name, range }));

		const spec: Record<string, Record<string, string>> = {};
		const seen: Map<string, string> = new Map();

		for (const root of declared) {
			const valid = root && typeof root.name === 'string' && root.name && typeof root.range === 'string';
			const kind = root?.kind || 'main';
			if (!valid || !groups[kind]) {
				const message = 'A root must have a package name, a version specifier and a known kind';
				this.#diagnostics.push({ code: 'ROOT_INVALID', message, severity: 'error' });
				continue;
			}

			const { name, range } = root;
			if (seen.has(name)) {
				if (seen.get(name) === `${kind}|${range}`) continue;
				const message = `Root "${name}" is required more than once with different specifiers or kinds`;
				this.#diagnostics.push({ code: 'ROOT_DUPLICATED', message, severity: 'error' });
				continue;
			}
			seen.set(name, `${kind}|${range}`);

			this.#list.push({ name, range, kind, targets: root.targets });
			(spec[groups[kind]] = spec[groups[kind]] || {})[name] = range;
		}

		this.#list.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

		const unavailable = async () => {
			throw new Error('The roots of a resolution are not installed');
		};
		this.#dependencies = { spec: <IPackageDependencies>spec, install: unavailable, update: unavailable };
	}
}
