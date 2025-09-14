import type { Request, Response, NextFunction, Application } from 'express';
import { createHash } from 'crypto';

export class ModulesRoutes {
	static setup(app: Application) {
		app.get('/m/@:scope/:pkg@:ver/modules/:mod', this.module);
		app.get('/m/:pkg@:ver/modules/:mod', this.module);
	}

	static module(req: Request, res: Response, next: NextFunction) {
		console.log('ModulesRoutes.module');

		try {
			const scope = req.params.scope || undefined;
			const pkg = req.params.pkg;
			const ver = req.params.ver;
			const mod = req.params.mod;

			const target = String(req.query.target || 'browser'); // browser | node
			const env = String(req.query.env || 'production'); // production | development
			const format = String(req.query.format || 'esm'); // esm | cjs | system
			const min = String(req.query.min || 'true') === 'true'; // boolean
			const map = String(req.query.sourcemap || 'external'); // inline | external | none
			const types = String(req.query.types || 'false') === 'true';
			const css = String(req.query.css || 'false') === 'true';

			function etag(s: string): string {
				const h = createHash('sha256').update(s).digest('hex').slice(0, 16);
				return `W/"${h}"`;
			}

			const code = 'Hello world!';

			// etag
			const tag = etag(code);
			if (req.headers['if-none-match'] === tag) {
				res.status(304).end();
				return;
			}

			if (map === 'external') {
				// const m = map_path({ scope, pkg, ver, mod, tgt, fmt, env, min });
				// res.setHeader('SourceMap', m);
				// res.setHeader('X-SourceMap', m);
			}
			if (types) {
				// const p = dts_path({ scope, pkg, ver, mod, tgt });
				// res.append('Link', `<${p}>; rel="describedby"; type="text/plain"`);
			}
			if (css) {
				// const p = css_path({ scope, pkg, ver, mod, tgt });
				// res.append('Link', `<${p}>; rel="preload"; as="style"`);
			}

			// headers
			res.type('application/javascript; charset=utf-8');
			res.setHeader('ETag', tag);
			res.setHeader('Cache-Control', env === 'production' ? 'public, max-age=31536000, immutable' : 'no-store');

			res.status(200).send(code);
		} catch (error) {
			next(error);
		}
	}
}
