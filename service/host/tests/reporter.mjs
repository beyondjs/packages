/**
 * The reporter a test run of the service gives Node's test runner (`--test-reporter=<this file>`): one JSON line per
 * test that ended, `{type: 'result', file, name, nesting, line, column, state, duration, error?: {message, stack}}`,
 * `state` being `passed`, `failed`, `skipped` or `todo`. Suites are not reported: their tests are. What a test writes
 * is not reported either; the service reads only these lines.
 */
export default async function* reporter(source) {
	for await (const event of source) {
		if (event.type !== 'test:pass' && event.type !== 'test:fail') continue;
		const { name, nesting, file, line, column, details = {}, skip, todo } = event.data;
		if (details.type === 'suite') continue;
		const state = skip !== undefined ? 'skipped' : todo !== undefined ? 'todo' : event.type === 'test:pass' ? 'passed' : 'failed';
		const cause = details.error?.cause ?? details.error;
		const error = state === 'failed' && cause ? { message: String(cause.message ?? cause), stack: typeof cause.stack === 'string' ? cause.stack : void 0 } : void 0;
		yield `${JSON.stringify({ type: 'result', file, name, nesting, line, column, state, duration: details.duration_ms, ...(error ? { error } : {}) })}\n`;
	}
}
