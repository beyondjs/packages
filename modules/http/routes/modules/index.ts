import type { Request, Response, NextFunction, Application } from 'express';
import { Paths } from './paths';
import { createHash } from 'crypto';

type TargetType = 'browser' | 'node';
type FormatType = 'esm' | 'cjs' | 'system';
type EnvironmentType = 'production' | 'development';
type MapType = 'external' | 'inline' | 'none';

export type IOptions = {
	scope?: string;
	package: string;
	version: string;
	module: string;
	target: TargetType;
	format: FormatType;
	environment: EnvironmentType;
	types: boolean;
	css: boolean;
	map: MapType;
	min: boolean;
};

export class ModulesRoutes {
	static setup(app: Application) {
		app.get('/m/@:scope/:pkg@:ver/modules/:mod', this.module);
		app.get('/m/:pkg@:ver/modules/:mod', this.module);
	}

	static module(req: Request, res: Response, next: NextFunction) {
		try {
			const options: IOptions = {
				scope: req.params.scope || void 0,
				package: req.params.pkg,
				version: req.params.ver,
				module: req.params.mod,
				target: <TargetType>req.query.target,
				environment: req.query.env === 'production' ? 'production' : 'development',
				format: <FormatType>req.query.format,
				map: <MapType>req.query.map,
				min: req.query.min ? true : false,
				types: req.query.types ? true : false,
				css: req.query.css ? true : false
			};

			function etag(s: string): string {
				const hash = createHash('sha256').update(s).digest('hex').slice(0, 16);
				return `W/"${hash}"`;
			}

			const code = 'Hello world!';

			// etag
			const tag = etag(code);
			if (req.headers['if-none-match'] === tag) {
				res.status(304).end();
				return;
			}

			if (options.map === 'external') {
				const m = Paths.map(options);
				res.setHeader('SourceMap', m);
				res.setHeader('X-SourceMap', m);
			}
			if (options.types) {
				const p = Paths.dts(options);
				res.append('Link', `<${p}>; rel="describedby"; type="text/plain"`);
			}
			if (options.css) {
				const p = Paths.css(options);
				res.append('Link', `<${p}>; rel="preload"; as="style"`);
			}

			// headers
			res.type('application/javascript; charset=utf-8');
			res.setHeader('ETag', tag);
			res.setHeader(
				'Cache-Control',
				options.environment === 'production' ? 'public, max-age=31536000, immutable' : 'no-store'
			);

			res.status(200).send(code);
		} catch (error) {
			next(error);
		}
	}
}
