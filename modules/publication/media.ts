import { extname } from 'path';

const TYPES: Record<string, string> = {
	'.js': 'text/javascript',
	'.mjs': 'text/javascript',
	'.css': 'text/css',
	'.map': 'application/json',
	'.json': 'application/json',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.avif': 'image/avif',
	'.ico': 'image/x-icon',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
	'.ttf': 'font/ttf',
	'.otf': 'font/otf',
	'.eot': 'application/vnd.ms-fontobject',
	'.txt': 'text/plain',
	'.wasm': 'application/wasm'
};

/**
 * The media type an output or a declared asset is served with, decided by its file extension
 */
export /*bundle*/ class Media {
	/**
	 * The extensions a stylesheet reference or a source import is treated as a static asset for
	 */
	static get assets(): string[] {
		const code = ['.js', '.mjs', '.css', '.map', '.json'];
		return Object.keys(TYPES).filter(extension => !code.includes(extension));
	}

	/**
	 * @returns `application/octet-stream` for an extension that is not known
	 */
	static of(file: string): string {
		return TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
	}
}
