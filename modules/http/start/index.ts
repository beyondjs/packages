import { Server } from '@beyond-js/api-server/main';

export /*bundle*/ const server = new (class {
	start() {
		const server = new Server();
		server.start('@beyond-js/packages/http/routes');
	}
})();
