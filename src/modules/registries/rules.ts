import type { TRegistryId, IRegistryAuth } from './types';

/**
 * Describes the behavior of a registry source.
 */
export type Rule = {
	hosts: string[];
	headers: (auth: IRegistryAuth) => Record<string, string>;
	validate?: (auth: IRegistryAuth) => void;
	build: (scope: string, name: string) => string;
};

const token = (auth: IRegistryAuth) => ({ Authorization: `Bearer ${auth.token}` });
const basic = (auth: IRegistryAuth) => ({ Authorization: `Basic ${auth.token}` });
const userpass = (auth: IRegistryAuth) => ({
	Authorization: `Basic ${Buffer.from(`${auth.user}:${auth.token}`).toString('base64')}`
});

/**
 * Known rules for registries, including hostnames, headers, and download logic.
 */
export const rules = new Map<TRegistryId, Rule>([
	[
		'npm',
		{
			hosts: ['registry.npmjs.org'],
			headers: token,
			build: (_, name) => `https://registry.npmjs.org/${name}/-/${name}.tgz`
		}
	],
	[
		'github',
		{
			hosts: ['github.com'],
			headers: token,
			build: () => '', // No .tgz for raw github packages
			validate: () => {
				throw new Error('GitHub source packages are not supported for .tgz downloads');
			}
		}
	],
	[
		'github-pkg',
		{
			hosts: ['npm.pkg.github.com'],
			headers: basic,
			build: (scope, name) => `https://npm.pkg.github.com/${scope}/${name}/-/${name}.tgz`
		}
	],
	[
		'gitlab',
		{
			hosts: ['gitlab.com'],
			headers: token,
			build: (scope, name) => `https://gitlab.com/api/v4/packages/npm/${scope}/${name}/-/${name}.tgz`
		}
	],
	[
		'bitbucket',
		{
			hosts: ['api.bitbucket.org'],
			headers: userpass,
			build: (scope, name) => `https://api.bitbucket.org/npm/${scope}/${name}/-/${name}.tgz`
		}
	],
	[
		'artifactory',
		{
			hosts: ['artifactory'],
			headers: token,
			build: (scope, name) => `https://artifactory/api/npm/${scope}/${name}/-/${name}.tgz`
		}
	],
	[
		'verdaccio',
		{
			hosts: ['localhost', '127.0.0.1'],
			headers: token,
			build: (scope, name) => `http://localhost:4873/${scope}/${name}/-/${name}.tgz`
		}
	],
	[
		'azure',
		{
			hosts: ['pkgs.dev.azure.com'],
			headers: basic,
			build: (scope, name) =>
				`https://pkgs.dev.azure.com/${scope}/_packaging/npm/npm/registry/${scope}/${name}/-/${name}.tgz`
		}
	],
	[
		'google',
		{
			hosts: ['pkg.dev', 'npm.pkg.dev'],
			headers: token,
			build: (scope, name) => `https://us-central1-npm.pkg.dev/${scope}/${name}/-/${name}.tgz`
		}
	],
	[
		'aws',
		{
			hosts: ['amazonaws.com'],
			headers: basic,
			build: (scope, name) =>
				`https://domain-id.d.codeartifact.us-east-1.amazonaws.com/npm/${scope}/${name}/-/${name}.tgz`
		}
	],
	[
		'custom',
		{
			hosts: [],
			headers: token,
			build: (scope, name) => `https://custom.registry/${scope}/${name}/-/${name}.tgz`
		}
	]
]);
