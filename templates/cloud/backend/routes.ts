/** The answer to one request: replace the routes with the service's own */
export function answer(method: string, path: string): { status: number; body: Record<string, unknown> } {
	if (method !== 'GET') return { status: 405, body: { error: { code: 'METHOD_NOT_ALLOWED' } } };
	if (path === '/health') return { status: 200, body: { status: 'ready' } };
	if (path === '/') return { status: 200, body: { message: 'Hello from Beyond' } };
	return { status: 404, body: { error: { code: 'NOT_FOUND' } } };
}
