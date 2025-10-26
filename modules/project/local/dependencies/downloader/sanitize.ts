import * as path from 'path';

/**
 * Sanitizes a tar entry path to prevent path traversal or escaping the target directory.
 * Throws an error if the path is unsafe.
 */
export function sanitize(name: string, root: string): string {
	// 1. Remove npm package prefix (most npm tarballs start with "package/")
	const stripped = name.replace(/^package\//, '');

	// Reject embedded null byte early
	if (stripped.includes('\0')) {
		throw new Error(`Unsafe tar entry path (null): ${name}`);
	}

	// 2. Normalize using POSIX semantics (tar always uses '/')
	const normalized = path.posix.normalize(stripped);

	// Reject empty or current dir
	if (!normalized || normalized === '.' || normalized === './') {
		throw new Error(`Unsafe tar entry path (empty): ${name}`);
	}

	// 3. Reject unsafe patterns
	// Comments in English:
	// - absolute path
	// - parent traversal
	// - empty segments
	// - backslashes (Windows trick)
	// - Windows drive letters
	if (
		normalized.startsWith('/') ||
		normalized.split('/').some(seg => seg === '..' || seg === '') ||
		/\\/.test(stripped) ||
		/^[A-Za-z]:/.test(stripped)
	) {
		throw new Error(`Unsafe tar entry path: ${name}`);
	}

	// 4. Convert to native separators and resolve under the root
	const sanitized = normalized.split('/').join(path.sep);
	// Resolve root to an absolute path first
	const base = path.resolve(root);
	const absolute = path.resolve(base, sanitized);

	// 5. Enforce that final path stays inside root using path.relative
	const relative = path.relative(base, absolute);
	// If relative is empty the path is the same as root (reject)
	// If it starts with '..' or is absolute it escapes root
	if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
		throw new Error(`Tar entry escapes destination: ${name}`);
	}

	// Return safe relative path (with native separators)
	return sanitized;
}
