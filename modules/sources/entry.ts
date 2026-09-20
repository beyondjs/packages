import type { Headers } from 'tar-stream';
import { Refusal } from './refusal';

/**
 * Decides what an archive entry is allowed to be. Only regular files are extracted and directories are
 * skipped; links, devices and any other entry type are refused, as is a path that could leave the
 * package directory. The first path segment (`package/`) is the archive root and is removed.
 */
export class Entry {
	/**
	 * @returns The relative path to write the file at, or undefined for an entry that is skipped
	 */
	static path(header: Headers): string | undefined {
		const { name, type } = header;

		if (type === 'directory') return;
		if (type !== 'file') {
			throw new Refusal('ENTRY_UNSUPPORTED', `Archive entries of type "${type}" are not allowed: "${name}"`);
		}

		const unsafe = (why: string) => new Refusal('ENTRY_UNSAFE', `Unsafe archive entry path (${why}): "${name}"`);
		if (typeof name !== 'string' || !name || name.includes('\0')) throw unsafe('empty or null');
		if (name.includes('\\')) throw unsafe('backslash');
		if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) throw unsafe('absolute');

		// Traversal is refused on the declared name: it is never normalized away
		const segments = name.split('/');
		if (segments.some(segment => segment === '..')) throw unsafe('parent traversal');

		const inner = segments.slice(1).filter(segment => segment !== '' && segment !== '.');
		if (!inner.length) throw unsafe('outside the package root');
		return inner.join('/');
	}
}
