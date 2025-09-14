import type { Application, Request, Response } from 'express';
import { ModulesRoutes } from './modules';
// import { InfoRoutes } from './info';
// import { DependenciesRoutes } from './dependencies';
import { join } from 'path';

export /*bundle*/ class Routes {
	static setup(app: Application) {
		app.get('/', (req: Request, res: Response) => res.send('BeyonsJS API HTTP Server'));

		ModulesRoutes.setup(app);
		// InfoRoutes.setup(app);
		// DependenciesRoutes.setup(app);
	}
}

export /*bundle*/ async function specs() {
	const { findUp } = await import('find-up');
	const root = await findUp('packages', { cwd: __dirname, type: 'directory' });
	return join(root, 'openapi/merged.yaml');
}
