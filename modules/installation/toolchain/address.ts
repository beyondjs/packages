/**
 * The archive address of a release the toolchain supplies, as a lock records it: `toolchain:<name>@<version>`. It
 * names the release, never where its archive is on a machine; the integrity the lock records beside it names the bytes.
 */
export class ToolchainAddress {
	static SCHEME = 'toolchain:';
	// The origin of a node the toolchain supplied, and the identity of the toolchain as a provider
	static PROVIDER = 'toolchain';

	static compose(name: string, version: string): string {
		return `${ToolchainAddress.SCHEME}${name}@${version}`;
	}

	/**
	 * The name and version of an archive address, or undefined when it is not one
	 */
	static parse(url: string): { name: string; version: string } | undefined {
		if (typeof url !== 'string' || !url.startsWith(ToolchainAddress.SCHEME)) return;
		const rest = url.slice(ToolchainAddress.SCHEME.length);
		const at = rest.lastIndexOf('@');
		if (at <= 0) return;
		const [name, version] = [rest.slice(0, at), rest.slice(at + 1)];
		return name && version ? { name, version } : void 0;
	}
}
