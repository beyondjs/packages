/**
 * How a check is run and reported. A failure does not interrupt the run, so one execution reports the
 * state of every checked behavior instead of only the first defect.
 */
export const results = [];

/**
 * @param name What the step establishes
 * @param fn The checks, which may return a short note describing what was observed
 */
export const step = async (name, fn) => {
	const started = Date.now();
	try {
		const notes = await fn();
		results.push({ name, ok: true, ms: Date.now() - started });
		console.log(`PASS ${name}${notes ? ` — ${notes}` : ''}`);
	} catch (error) {
		results.push({ name, ok: false, ms: Date.now() - started, error });
		console.log(`FAIL ${name}\n${error.stack}`);
	}
};

/**
 * Prints the totals and sets the exit code
 */
export const summary = () => {
	const passed = results.filter(({ ok }) => ok).length;
	console.log(`\n${passed}/${results.length} passed`);
	process.exitCode = passed === results.length ? 0 : 1;
};

/**
 * The codes of the diagnostics of a document, sorted
 */
export const codes = (document, severity) =>
	document.diagnostics
		.filter(diagnostic => !severity || diagnostic.severity === severity)
		.map(({ code }) => code)
		.sort();

/**
 * A graph is usable when none of its diagnostics is an error
 */
export const valid = document => !document.diagnostics.some(({ severity }) => severity === 'error');

/**
 * Helpers to read a graph document by package name instead of by node key
 */
export const versions = (document, name) =>
	Object.values(document.nodes)
		.filter(node => node.name === name)
		.map(({ version }) => version)
		.sort();

export const root = (document, name) => document.roots.find(root => root.name === name)?.node;

export const edge = (document, from, name) =>
	document.edges.find(
		edge =>
			edge.from.includes(`:${from}@`) &&
			(edge.name === name || (edge.to && document.nodes[edge.to].name === name))
	);
