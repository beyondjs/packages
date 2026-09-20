/**
 * The packages the fetch checks work with: a small application graph, and archives built to be refused.
 */
export async function fixtures(registry) {
	await registry.publish({
		name: 'app-shell',
		version: '1.0.0',
		dependencies: { 'app-ui': '^1.0.0', 'app-core': '^1.0.0' }
	});
	await registry.publish({
		name: 'app-ui',
		version: '1.1.0',
		dependencies: { 'app-core': '^1.0.0' },
		files: { 'index.js': 'export const ui = 1;', 'styles/main.css': 'a{}' }
	});
	await registry.publish({ name: 'app-core', version: '1.0.3' });
	await registry.publish({ name: 'app-extra', version: '2.0.0', dependencies: { 'app-core': '^1.0.0' } });

	// Small compressed, large extracted: what a decompression bomb looks like
	await registry.publish({ name: 'bomb', version: '1.0.0', files: { 'zeros.bin': Buffer.alloc(8 * 1024 * 1024) } });
	await registry.publish({ name: 'bulky', version: '1.0.0', files: { 'noise.bin': noise(256 * 1024) } });

	const many = {};
	for (let index = 0; index < 60; index++) many[`files/${index}.js`] = `export default ${index};`;
	await registry.publish({ name: 'many-entries', version: '1.0.0', files: many });

	const manifest = name => ({ name: 'package/package.json', content: JSON.stringify({ name, version: '1.0.0' }) });
	await registry.publish({
		name: 'traversal',
		version: '1.0.0',
		entries: [manifest('traversal'), { name: 'package/../../escaped.txt', content: 'escaped' }]
	});
	await registry.publish({
		name: 'linked',
		version: '1.0.0',
		entries: [manifest('linked'), { name: 'package/link', type: 'symlink', linkname: '/etc/hosts' }]
	});
	await registry.publish({
		name: 'absolute',
		version: '1.0.0',
		entries: [manifest('absolute'), { name: '/tmp/beyond-absolute.txt', content: 'absolute' }]
	});
}

/**
 * Bytes that do not compress
 */
function noise(length) {
	const bytes = Buffer.alloc(length);
	let state = 0x2545f491;
	for (let index = 0; index < length; index++) {
		state ^= state << 13;
		state ^= state >>> 17;
		state ^= state << 5;
		bytes[index] = state & 0xff;
	}
	return bytes;
}
