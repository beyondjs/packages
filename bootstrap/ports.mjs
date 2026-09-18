import { createServer } from 'node:net';

/**
 * Local ports that are free when asked for. The bootstrap servers take their port from a manifest, so the
 * port has to be chosen before they start; asking the system for it avoids assuming any fixed port is free.
 */
export class Ports {
	/**
	 * @returns {Promise<number>}
	 */
	static free() {
		return new Promise((resolve, reject) => {
			const server = createServer();
			server.unref();
			server.once('error', reject);
			server.listen(0, '127.0.0.1', () => {
				const { port } = server.address();
				server.close(() => resolve(port));
			});
		});
	}
}
