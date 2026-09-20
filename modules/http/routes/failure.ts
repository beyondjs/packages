import type { Response } from 'express';

/**
 * How a failure is answered: the JSON body of the error, never cached and without validators.
 *
 * The compiled-module contract defines an `ETag` for the artifact answers (200 and 304) only. Express adds
 * a weak one to every body it serializes itself, which would make an error of this service differ from the
 * same error of a published service in a header neither means. The body is therefore written directly, so
 * no validator is ever computed for it, and one a handler had already set for the artifact is removed.
 */
export class Failure {
	/**
	 * @param body The document to answer, serialized exactly as `response.json` would
	 */
	static send(response: Response, status: number, body: unknown): void {
		const content = Buffer.from(JSON.stringify(body), 'utf-8');
		response.removeHeader('ETag');
		response.status(status);
		response.setHeader('Cache-Control', 'no-store');
		response.setHeader('Content-Type', 'application/json; charset=utf-8');
		response.setHeader('Content-Length', content.byteLength);
		response.end(content);
	}
}
