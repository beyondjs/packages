// Requires a package its manifest does not declare: nothing says it may be absent
try {
	require('never-declared');
} catch {}
