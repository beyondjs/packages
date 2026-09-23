/**
 * Sources that are not a registry range: aliases, git references and archive URLs. Each is either pinned
 * to real content or refused with a diagnostic; none is pinned to a placeholder.
 */
import assert from 'node:assert/strict';
import { DependencySource, GitInfo } from '@beyond-js/packages/dependency-source';
import { step, codes, valid, versions, root } from './harness.mjs';
import { Forge, commit } from './forge.mjs';

const COMMIT = '0123456789abcdef0123456789abcdef01234567';

/**
 * The widgets repository of the test host: `main` at one commit, an annotated tag at another and a lightweight
 * tag at a third, each with the manifest of that commit
 */
const repository = forge => {
	const manifest = version => ({ name: '@acme/widgets', version, dependencies: { 'cycle-a': '^1.0.0' } });
	const [main, tagged, light] = ['widgets main', 'widgets 2.0.0', 'widgets light'].map(commit);
	forge.repository('acme/widgets', {
		commits: {
			[main]: { manifest: manifest('3.0.0') },
			[tagged]: { manifest: manifest('2.0.0') },
			[light]: { manifest: manifest('2.1.0') },
			[COMMIT]: { manifest: manifest('1.0.0') }
		},
		branches: { main },
		annotated: { 'v2.0.0': tagged },
		tags: { light }
	});
	// Another repository whose manifest declares the same name and version as `main` of the first
	forge.repository('other/widgets', { commits: { [commit('other main')]: { manifest: manifest('3.0.0') } }, branches: { main: commit('other main') } });
	return { main, tagged, light };
};

export async function kinds({ registry, pin }) {
	await step('parsing: a specifier that is not git reaches the URL and alias branches', async () => {
		assert.equal(GitInfo.parse('^1.0.0'), undefined);
		assert.equal(GitInfo.parse('npm:lodash@^4.0.0'), undefined);
		assert.equal(new GitInfo('https://host.example/pkg.tgz').matched, false);

		assert.equal(
			new DependencySource('pkg', 'https://host.example:8443/files/pkg-1.0.0.tgz#sha512-AAAA').data.is,
			'url'
		);
		// An archive is classified by its form, never by its host: on a registry or a git host it is an archive
		for (const url of ['https://registry.npmjs.org/react/-/react-18.3.1.tgz', 'https://github.com/acme/widgets/archive/v1.tar.gz']) {
			assert.equal(new DependencySource('pkg', url).data.is, 'url', url);
		}
		const repository = new DependencySource('pkg', 'https://forge.example/acme/widgets.git#main').data;
		assert.deepEqual([repository.is, repository.baseurl, repository.repo, repository.ref], ['git', 'forge.example', 'widgets', 'main']);
		assert.equal(new DependencySource('pkg', 'npm:lodash@^4.0.0').data.is, 'alias');
		assert.equal(new DependencySource('pkg', 'not a specifier').data.is, 'error');

		const shorthand = new DependencySource('pkg', 'gitlab:acme/widgets#v1').data;
		assert.deepEqual(
			[shorthand.is, shorthand.baseurl, shorthand.owner, shorthand.repo, shorthand.ref],
			['git', 'gitlab.com', 'acme', 'widgets', 'v1']
		);
		const full = new DependencySource('pkg', `git+ssh://git@Forge.Example:2222/acme/widgets.git#${COMMIT}`).data;
		assert.deepEqual(
			[full.baseurl, full.owner, full.repo, full.pinned],
			['forge.example:2222', 'acme', 'widgets', true]
		);
	});

	await step('alias: the declared name is kept on the edge, the node is the target package', async () => {
		const document = await pin({
			roots: { base: 'npm:diamond-base@~1.2.0', 'alias-user': '1.0.0', 'diamond-left': '1.0.0' }
		});
		assert.ok(valid(document), JSON.stringify(document.diagnostics));

		const selection = document.roots.find(({ name }) => name === 'base');
		assert.equal(selection.range, 'npm:diamond-base@~1.2.0');
		assert.ok(selection.node.endsWith(':diamond-base@1.2.5'));

		// The alias, a transitive alias and the direct requirement of the same package share one node
		assert.deepEqual(versions(document, 'diamond-base'), ['1.2.5']);
		assert.ok(!Object.values(document.nodes).some(({ name }) => name === 'base' || name === 'renamed'));
		const aliased = document.edges.find(({ name }) => name === 'renamed');
		assert.deepEqual([aliased.to, aliased.range], [selection.node, 'npm:diamond-base@^1.2.0']);
	});

	await step('git: a branch, a tag and the default branch are pinned to commits through the reference advertisement', async () => {
		const forge = await new Forge().start();
		try {
			const commits = repository(forge);
			const providers = { values: { default: { registry: registry.url } }, forges: { [forge.host]: 'gitlab' } };
			const pinned = async ref => {
				const document = await pin({ roots: { widgets: `git+http://${forge.host}/acme/widgets.git${ref}` }, providers });
				assert.ok(valid(document), JSON.stringify(document.diagnostics));
				const key = root(document, 'widgets');
				return { document, key, node: document.nodes[key] };
			};

			const branch = await pinned('#main');
			assert.equal(branch.key, `git:${forge.host}/acme/widgets@${commits.main}`);
			assert.deepEqual([branch.node.name, branch.node.version, branch.node.integrity], ['@acme/widgets', '3.0.0', null]);
			assert.match(branch.node.origin.provider, /^git-127-0-0-1-\d+-acme-widgets-[0-9a-f]{32}$/);
			assert.equal(branch.node.origin.registry, `http://${forge.host}/acme/widgets/`);
			assert.equal(branch.node.tarball, `http://${forge.host}/acme/widgets/-/archive/${commits.main}/widgets-${commits.main}.tar.gz`);
			assert.deepEqual(branch.document.exceptions.map(({ node, kind }) => [node, kind]), [[branch.key, 'manifest-fetch']]);
			assert.deepEqual(versions(branch.document, 'cycle-b'), ['1.0.0'], 'the manifest of the commit was followed');

			assert.equal((await pinned('#v2.0.0')).key, `git:${forge.host}/acme/widgets@${commits.tagged}`, 'an annotated tag is its commit');
			assert.equal((await pinned('#v2.0.0')).node.version, '2.0.0');
			assert.equal((await pinned('#light')).key, `git:${forge.host}/acme/widgets@${commits.light}`);
			assert.equal((await pinned('')).key, `git:${forge.host}/acme/widgets@${commits.main}`, 'no reference is the default branch');
			assert.equal((await pinned(`#${COMMIT}`)).key, `git:${forge.host}/acme/widgets@${COMMIT}`, 'a full commit is pinned as is');

			// Nothing but the advertisement, the manifests and no archive: a resolution reads metadata only
			assert.equal(forge.requests.archive, 0);
			assert.equal(forge.requests.other, 0);
			return `${forge.requests.refs} advertisements, ${forge.requests.manifest} manifests`;
		} finally {
			await forge.stop();
		}
	});

	await step('git: the repository is part of the identity, and what cannot be pinned is refused', async () => {
		const forge = await new Forge().start();
		try {
			repository(forge);
			const providers = { values: { default: { registry: registry.url } }, forges: { [forge.host]: 'gitlab' } };
			const document = await pin({
				roots: { widgets: `git+http://${forge.host}/acme/widgets.git#main`, fork: `git+http://${forge.host}/other/widgets.git#main` },
				providers
			});
			assert.ok(valid(document), JSON.stringify(document.diagnostics));
			const [mine, other] = [root(document, 'widgets'), root(document, 'fork')];
			assert.notEqual(mine, other);
			assert.deepEqual([document.nodes[mine].version, document.nodes[other].version], ['3.0.0', '3.0.0']);
			assert.notEqual(document.nodes[mine].origin.provider, document.nodes[other].origin.provider);

			const refused = async (spec, code, options = providers) => {
				forge.reset();
				const document = await pin({ roots: { widgets: spec }, providers: options });
				assert.equal(valid(document), false, spec);
				assert.deepEqual(codes(document, 'error'), [code], spec);
				assert.deepEqual(Object.keys(document.nodes), [], spec);
				return forge.requests;
			};
			await refused(`git+http://${forge.host}/acme/widgets.git#absent`, 'GIT_REFERENCE_NOT_FOUND');
			await refused(`git+http://${forge.host}/acme/widgets.git#0123456`, 'GIT_REFERENCE_NOT_FOUND');
			await refused(`git+http://${forge.host}/acme/widgets.git#main::path:packages/a`, 'SOURCE_UNSUPPORTED');
			await refused(`git+http://${forge.host}/group/sub/widgets.git#main`, 'SOURCE_UNSUPPORTED');
			await refused(`git+http://${forge.host}/acme/widgets.git#semver:^2`, 'SOURCE_UNSUPPORTED');

			// A host of no known kind is refused before anything is requested from it, a full commit included
			const undeclared = { values: { default: { registry: registry.url } } };
			for (const spec of [`git+http://${forge.host}/acme/widgets.git#main`, `git+http://${forge.host}/acme/widgets.git#${COMMIT}`]) {
				const requests = await refused(spec, 'SOURCE_UNSUPPORTED', undeclared);
				assert.deepEqual(requests, { refs: 0, manifest: 0, archive: 0, other: 0 }, spec);
			}
		} finally {
			await forge.stop();
		}
	});

	await step('url: an archive URL is identified by its content digest, whatever host it names', async () => {
		const release = registry.release('diamond-base', '1.0.0');
		const url = `${registry.url}/diamond-base/-/diamond-base-1.0.0.tgz`;
		const hex = Buffer.from(release.integrity.slice('sha512-'.length), 'base64').toString('hex');

		// Declared integrity: pinned without a request
		registry.reset();
		const declared = await pin({ roots: { archive: `${url}#${release.integrity}` } });
		assert.ok(valid(declared), JSON.stringify(declared.diagnostics));
		const [key] = Object.keys(declared.nodes);
		const node = declared.nodes[key];
		assert.equal(key, `digest:sha512-${hex}`);
		assert.deepEqual([node.name, node.integrity, node.tarball, node.origin.provider], ['archive', release.integrity, url, 'digest']);
		assert.match(node.version, /^0\.0\.0-url\.[0-9a-f]{32}$/);
		assert.deepEqual(codes(declared, 'warning'), ['URL_DEPENDENCIES_UNKNOWN']);
		assert.deepEqual(declared.exceptions, []);
		assert.equal(registry.requests.tarball, 0);

		// No integrity: downloaded once and pinned by its digest, recorded as an exception
		registry.reset();
		const downloaded = await pin({ roots: { archive: url, again: url } });
		assert.ok(valid(downloaded), JSON.stringify(downloaded.diagnostics));
		assert.deepEqual(Object.keys(downloaded.nodes), [key], 'the same content is one node');
		assert.equal(downloaded.nodes[key].integrity, release.integrity);
		assert.equal(registry.requests.tarball, 1, 'one download for both roots');
		assert.deepEqual(downloaded.exceptions.map(({ node, kind, provider }) => [node, kind, provider]), [[key, 'archive-fetch', 'digest']]);
	});

	await step('url: an unusable integrity or archive is refused, never pinned to a placeholder', async () => {
		const url = `${registry.url}/diamond-base/-/diamond-base-1.0.0.tgz`;
		const sha1 = `sha1-${Buffer.from(registry.release('diamond-base', '1.0.0').shasum, 'hex').toString('base64')}`;
		for (const [spec, code] of [
			[`${url}#${sha1}`, 'INTEGRITY_UNSUPPORTED'],
			[`${url}#not-an-integrity`, 'INTEGRITY_UNSUPPORTED'],
			[`${registry.url}/diamond-base/-/diamond-base-9.9.9.tgz`, 'ARCHIVE_NOT_FOUND']
		]) {
			const document = await pin({ roots: { archive: spec } });
			assert.equal(valid(document), false, spec);
			assert.deepEqual(codes(document, 'error'), [code], spec);
			assert.deepEqual(Object.keys(document.nodes), [], spec);
		}
	});
}
