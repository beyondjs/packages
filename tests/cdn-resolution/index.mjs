/**
 * Validation of the first stage of a published build: the pinned package/version graph, the providers it
 * reads and what it never does. Run under BEE Node with the bootstrap Engine serving the implementation.
 */
import { Resolution } from '@beyond-js/packages/resolution';
import { FakeRegistry } from './registry.mjs';
import { summary } from './harness.mjs';
import { graph, fixtures } from './graph.mjs';
import { structure } from './structure.mjs';
import { kinds } from './kinds.mjs';
import { metadata } from './metadata.mjs';
import { providers } from './providers.mjs';
import { visibility } from './visibility.mjs';
import { contract } from './contract.mjs';

const registry = await new FakeRegistry({ prefix: '/npm' }).start();
await fixtures(registry);

// Every resolution is isolated from the rc files and the environment of whoever runs the checks
const documents = [];
const pin = async params => {
	const document = await Resolution.pin({
		providers: { values: { default: { registry: registry.url } } },
		...params
	});
	documents.push(document);
	return document;
};

try {
	await graph({ registry, pin });
	await structure({ registry, pin });
	await kinds({ registry, pin });
	await metadata({ registry, pin });
	await providers({ registry, pin, documents });
	await visibility({ registry, documents });
	await contract({ documents });
} finally {
	await registry.stop();
}
summary();
