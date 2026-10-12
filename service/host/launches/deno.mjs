/**
 * The module a Deno launch runs (`Command`): it imports the public specifier it is given as its first argument, which
 * Deno resolves through the import map of the development service, as the command line's launcher does for Node.
 * Executing a module means importing it: its top-level code runs once, and an application that stays alive (a server)
 * keeps the process alive. It is run by Deno only, never imported by the service.
 *
 * Usage: deno run --import-map=<origin>/importmap.json?target=node&format=esm deno.mjs <public specifier>
 */
const [specifier] = globalThis.Deno.args;

try {
	await import(specifier);
} catch (error) {
	// A failed import and an exception of the application are both a failed execution
	console.error(error?.stack ?? error);
	globalThis.Deno.exitCode = 1;
}
