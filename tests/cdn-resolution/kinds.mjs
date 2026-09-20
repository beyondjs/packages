/**
 * Sources that are not a registry range: aliases, git references and archive URLs. Each is either pinned
 * to real content or refused with a diagnostic; none is pinned to a placeholder.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { DependencySource, GitInfo } from '@beyond-js/packages/dependency-source';
import { step, codes, valid, versions, root } from './harness.mjs';

const COMMIT = '0123456789abcdef0123456789abcdef01234567';

/**
 * A git forge that serves the manifest of one repository at one commit
 */
const forge = async () => {
	const requests = [];
	const server = createServer((request, response) => {
		requests.push(request.url);
		const found = request.url === `/acme/widgets/raw/${COMMIT}/package.json`;
		response.writeHead(found ? 200 : 404, { 'content-type': 'application/json' });
		response.end(
			JSON.stringify(
				found ? { name: '@acme/widgets', version: '3.0.0', dependencies: { 'cycle-a': '^1.0.0' } } : {}
			)
		);
	});
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	const stop = () => new Promise(resolve => server.close(resolve));
	return { host: `127.0.0.1:${server.address().port}`, requests, stop };
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

	await step('git: a reference is pinned to a real commit, or refused', async () => {
		const git = await forge();
		try {
			const branch = await pin({ roots: { widgets: `git+http://${git.host}/acme/widgets.git#main` } });
			assert.equal(valid(branch), false);
			assert.deepEqual(codes(branch, 'error'), ['SOURCE_UNSUPPORTED']);
			assert.deepEqual(Object.keys(branch.nodes), []);

			const pinned = await pin({ roots: { widgets: `git+http://${git.host}/acme/widgets.git#${COMMIT}` } });
			assert.ok(valid(pinned), JSON.stringify(pinned.diagnostics));
			const key = root(pinned, 'widgets');
			const node = pinned.nodes[key];
			assert.match(key, /^git-127-0-0-1-\d+-[0-9a-f]{8}:@acme\/widgets@3\.0\.0\+git\.[0-9a-f]{40}$/);
			assert.deepEqual([node.version, node.integrity], [`3.0.0+git.${COMMIT}`, null]);
			assert.equal(node.tarball, `http://${git.host}/acme/widgets/archive/${COMMIT}.tar.gz`);
			assert.deepEqual(
				pinned.exceptions.map(({ node, kind }) => [node, kind]),
				[[key, 'manifest-fetch']]
			);
			assert.deepEqual(versions(pinned, 'cycle-b'), ['1.0.0'], 'the git manifest was not followed');
		} finally {
			await git.stop();
		}
	});

	await step('url: an archive URL requires its content integrity', async () => {
		const release = registry.release('diamond-base', '1.0.0');
		const url = `${registry.url}/diamond-base/-/diamond-base-1.0.0.tgz`;

		const bare = await pin({ roots: { archive: url } });
		assert.equal(valid(bare), false);
		assert.deepEqual(codes(bare, 'error'), ['INTEGRITY_REQUIRED']);

		registry.reset();
		const pinned = await pin({ roots: { archive: `${url}#${release.integrity}` } });
		assert.ok(valid(pinned), JSON.stringify(pinned.diagnostics));
		const [node] = Object.values(pinned.nodes);
		assert.deepEqual([node.name, node.integrity, node.tarball], ['archive', release.integrity, url]);
		assert.match(node.version, /^0\.0\.0-url\.[0-9a-f]{32}$/);
		assert.match(node.origin.provider, /^url-/);
		assert.deepEqual(codes(pinned, 'warning'), ['URL_DEPENDENCIES_UNKNOWN']);
		assert.deepEqual(pinned.exceptions, []);
		assert.equal(registry.requests.tarball, 0);
	});
}
