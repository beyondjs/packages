import type { Request } from 'express';
import type { TargetType, FormatType, EnvironmentType, SourceMapType } from './types';
import type { IPackageIdentifier, IGitIdentifier } from './types';
import { Parse } from './helpers';

/**
 * Class representing a module request, parsing parameters from an Express request.
 */
export class Options {
	#package: IPackageIdentifier;
	get package() {
		return this.#package;
	}

	#git?: IGitIdentifier;
	get git() {
		return this.#git;
	}

	#digest?: string; // 'sha256-...' | 'sha256u-...'
	get digest() {
		return this.#digest;
	}

	get identifier() {
		if (this.#package) {
			const { scope, name: pname, version } = this.#package;
			const name = (scope ? `@${scope}/` : '') + pname;
			return `semver://${name}@${version}`;
		} else if (this.#git) {
			const { host, owner, repo, commit } = this.#git;
			return `git://${host}/${owner}/${repo}@${commit}`;
		} else if (this.#digest) {
			return `digest://${this.#digest}`;
		}
	}

	#module!: string;
	get module() {
		return this.#module;
	}

	#target!: TargetType;
	get target() {
		return this.#target;
	}

	#format: FormatType;
	get format() {
		return this.#format;
	}

	#environment: EnvironmentType;
	get environment() {
		return this.#environment;
	}

	#sourcemap: SourceMapType;
	get sourcemap() {
		return this.#sourcemap;
	}

	#min: boolean;
	get min() {
		return this.#min;
	}

	#types: boolean;
	get types() {
		return this.#types;
	}

	#css: boolean;
	get css() {
		return this.#css;
	}

	constructor(request: Request) {
		const { env, target, format, sourcemap } = request.query;
		this.#environment = Parse.one<EnvironmentType>(env, ['production', 'development'], 'production');
		this.#target = Parse.one<TargetType>(target, ['browser', 'node']);
		this.#format = Parse.one<FormatType>(format, ['esm', 'cjs', 'system']);
		this.#sourcemap = Parse.one<SourceMapType>(sourcemap, ['external', 'inline', 'none'], 'external');

		this.#min = Parse.bool(request.query.min, true);
		this.#types = Parse.bool(request.query.types, false);
		this.#css = Parse.bool(request.query.css, false);

		// Common across all routes
		this.#module = request.params.mod;

		/**
		 * NPM Registry (scoped packages)
		 * Matches scoped and unscoped packages
		 * /m/@:scope/:pkg@:ver/modules/:mod
		 * /m/:pkg@:ver/modules/:mod
		 */
		if (request.path.startsWith('/m/npm/')) {
			const { scope, pkg: name, ver: version } = request.params;
			if (name && version) this.#package = { rid: 'npm', scope, name, version };
		}

		/**
		 * Git by commit
		 * /m/git/:host/:owner/:repo@:commit/modules/:mod
		 */
		if (request.path.startsWith('/m/git/')) {
			const { host, owner, repo, commit } = request.params;
			if (host && owner && repo && commit) this.#git = { host, owner, repo, commit };
		}

		/**
		 * Digest by sha256 or sha256u
		 * /m/digest/:digest/modules/:mod
		 */
		if (request.path.startsWith('/m/digest/')) {
			const { digest } = request.params;
			if (digest) this.#digest = digest;
		}

		/**
		 * Registry-based package
		 * Matches scoped and unscoped packages from any registry
		 * /m/:rid/@:scope/:pkg@:ver/modules/:mod
		 * /m/:rid/:pkg@:ver/modules/:mod
		 */
		if (request.path.startsWith('/m/')) {
			const seg = request.path.split('/')[2]; // segment after /m/
			if (seg && seg !== 'npm' && seg !== 'git' && seg !== 'digest') {
				const rid = request.params.rid || seg; // Express param 'rid' per route
				const { scope, pkg: name, ver: version } = request.params;
				if (rid && name && version) this.#package = { rid, scope, name, version };
			}
		}

		/**
		 * NPM fallback (unscoped and scoped)
		 * This is the fallback for routes that do not specify the registry
		 * It assumes the npm registry if no other identifier has been set
		 *
		 * /m/@:scope/:pkg@:ver/modules/:mod
		 * /m/:pkg@:ver/modules/:mod
		 */
		if (!this.#package && !this.#git && !this.#digest) {
			const { scope, pkg: name, ver: version } = request.params;
			if (name && version) this.#package = { rid: 'npm', scope, name, version };
		}
	}
}
